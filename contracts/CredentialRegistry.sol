// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/**
 * @title CredentialRegistry
 * @notice Minimal commitment and status registry for PostcodeProof address credentials.
 * @dev Non-upgradeable: no proxy, initializer, or upgrade mechanism. Built for Solidity
 * 0.8.28, OpenZeppelin 5.6.1, and the project's Cancun EVM configuration.
 * Never submit personal data, postal addresses, GPS coordinates, or emails: only
 * opaque credential IDs and keccak256 commitments to off-chain credential documents.
 * Wallet addresses, commitments, timestamps, and their associations are public;
 * hashing alone does not hide predictable documents. Use high-entropy randomness
 * within the off-chain document before hashing it. No document content is accepted.
 * No payable functions, receive/fallback, native-value accounting, or token operations:
 * Arc native gas (18 decimals) cannot be confused with ERC-20 USDC (6 decimals).
 * This is not a custodian and does not accept funds through its interface; forced
 * native transfers and unsolicited ERC-20 balances cannot be prevented by a recipient.
 * Owner (intended to become a multisig) and all current issuers must remain distinct.
 * Removing/rotating issuers never invalidates their existing credentials; for key
 * compromise the owner can revoke individual credentials, even while paused.
 * Only signature verification may call external code, via ERC-1271 STATICCALL;
 * all validation finishes before state writes, and no interaction follows them.
 */
contract CredentialRegistry is Ownable2Step, EIP712, Pausable {
    /// @notice Maximum credential lifetime measured from registration.
    uint256 public constant MAX_VALIDITY = 730 days;
    /// @notice Maximum remaining lifetime of a submitted authorization.
    uint256 public constant MAX_DEADLINE_WINDOW = 7 days;
    /// @notice Exact EIP-712 attestation schema; issuer is the signature verifier.
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(bytes32 credentialId,bytes32 commitment,address holder,uint64 expiresAt,uint64 deadline)"
    );
    /// @notice Exact EIP-712 revocation schema.
    bytes32 public constant REVOCATION_TYPEHASH = keccak256("Revocation(bytes32 credentialId,uint64 deadline)");

    /// @notice Credential lifecycle; revocation takes precedence over expiration.
    enum Status { None, Active, Expired, Revoked }

    /// @notice Public minimal record; no off-chain credential document is stored.
    struct Credential {
        /// @notice Wallet that registered this credential.
        address holder;
        /// @notice Issuer authorized at registration, retained through key rotation.
        address issuer;
        /// @notice keccak256 hash of the off-chain credential document.
        bytes32 commitment;
        /// @notice Exclusive validity end, in Unix seconds.
        uint64 expiresAt;
        /// @notice Registration time, in Unix seconds.
        uint64 registeredAt;
        /// @notice Permanent revocation flag.
        bool revoked;
    }

    /// @notice Currently authorized issuers; historical issuance remains valid after removal.
    mapping(address issuer => bool authorized) public isIssuer;
    /// @notice Number of authorized issuers; never falls below one.
    uint256 public issuerCount;
    /// @notice Records persist permanently, including expired and revoked credentials.
    mapping(bytes32 credentialId => Credential credential) public credentials;
    /// @notice Permanent commitment uniqueness index; zero means unused.
    mapping(bytes32 commitment => bytes32 credentialId) public commitmentToCredentialId;

    /// @notice An address required to be nonzero was zero.
    error ZeroAddress();
    /// @notice Initial administrative and issuance roles must use different wallets.
    error InitialRolesMustDiffer();
    /// @notice Administrative ownership and current issuance authority must remain separate.
    error OwnerCannotBeIssuer();
    /// @notice The proposed issuer is already authorized.
    error IssuerAlreadyExists();
    /// @notice The supplied issuer is not currently authorized.
    error UnauthorizedIssuer();
    /// @notice Removing the last authorized issuer is forbidden.
    error LastIssuer();
    /// @notice Rotation requires two distinct wallets.
    error IdenticalIssuers();
    /// @notice A credential ID cannot be zero.
    error ZeroCredentialId();
    /// @notice A commitment cannot be zero.
    error ZeroCommitment();
    /// @notice This credential ID was previously registered.
    error CredentialIdAlreadyUsed();
    /// @notice This commitment was previously registered, under any credential ID.
    error CommitmentAlreadyUsed();
    /// @notice Expiration must be in the future and within MAX_VALIDITY.
    error InvalidExpiration();
    /// @notice The authorization deadline has passed.
    error DeadlineExpired();
    /// @notice The authorization deadline exceeds MAX_DEADLINE_WINDOW.
    error DeadlineTooFar();
    /// @notice The supplied signature does not authorize the typed data.
    error InvalidSignature();
    /// @notice No credential exists for the supplied ID.
    error NotFound();
    /// @notice The credential has already been permanently revoked.
    error AlreadyRevoked();
    /// @notice Caller is neither the holder, a current issuer, nor the owner.
    error UnauthorizedRevoker();
    /// @notice Administrative ownership cannot be renounced.
    error RenounceOwnershipDisabled();

    /// @notice An issuer was authorized, including the initial issuer.
    event IssuerAdded(address indexed issuer);
    /// @notice An issuer was removed without changing historical credential status.
    event IssuerRemoved(address indexed issuer);
    /// @notice Issuance authority moved atomically without changing issuerCount.
    event IssuerRotated(address indexed oldIssuer, address indexed newIssuer);
    /// @notice A holder anchored an authorized credential commitment.
    event CommitmentRegistered(
        bytes32 indexed credentialId,
        bytes32 indexed commitment,
        address indexed holder,
        address issuer,
        uint64 expiresAt
    );
    /// @notice A credential was revoked; revokedBy is the authorizer, not a relayer.
    event CredentialRevoked(bytes32 indexed credentialId, address indexed revokedBy);

    /// @notice Initializes separate administrative and issuance wallets.
    /// @param initialOwner Initial owner, intended for two-step transfer to a multisig.
    /// @param initialIssuer Initial authorized EOA or ERC-1271 issuer wallet.
    constructor(address initialOwner, address initialIssuer)
        Ownable(initialOwner)
        EIP712("PostcodeProof Credential Registry", "1")
    {
        if (initialIssuer == address(0)) revert ZeroAddress();
        if (initialOwner == initialIssuer) revert InitialRolesMustDiffer();
        isIssuer[initialIssuer] = true;
        issuerCount = 1;
        emit IssuerAdded(initialIssuer);
    }

    /// @notice Authorizes a nonzero issuer other than the owner; does not affect existing records.
    function addIssuer(address issuer) external onlyOwner {
        if (issuer == address(0)) revert ZeroAddress();
        if (issuer == owner()) revert OwnerCannotBeIssuer();
        if (isIssuer[issuer]) revert IssuerAlreadyExists();
        isIssuer[issuer] = true;
        issuerCount += 1;
        emit IssuerAdded(issuer);
    }

    /// @notice Removes an issuer, preserving at least one and all historical records.
    function removeIssuer(address issuer) external onlyOwner {
        if (!isIssuer[issuer]) revert UnauthorizedIssuer();
        if (issuerCount == 1) revert LastIssuer();
        isIssuer[issuer] = false;
        issuerCount -= 1;
        emit IssuerRemoved(issuer);
    }

    /// @notice Atomically replaces an issuer, including the last issuer, without revoking credentials.
    /// @dev The new issuer must not be the owner.
    function rotateIssuer(address oldIssuer, address newIssuer) external onlyOwner {
        if (oldIssuer == address(0) || newIssuer == address(0)) revert ZeroAddress();
        if (newIssuer == owner()) revert OwnerCannotBeIssuer();
        if (oldIssuer == newIssuer) revert IdenticalIssuers();
        if (!isIssuer[oldIssuer]) revert UnauthorizedIssuer();
        if (isIssuer[newIssuer]) revert IssuerAlreadyExists();
        isIssuer[oldIssuer] = false;
        isIssuer[newIssuer] = true;
        emit IssuerRotated(oldIssuer, newIssuer);
    }

    /// @notice Stops new registrations only; revocation and administration remain available.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes new registrations.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Accepts pending ownership only if the caller is not a current issuer.
    /// @dev Issuer status is checked at acceptance time, not when ownership is proposed.
    function acceptOwnership() public override {
        if (isIssuer[msg.sender]) revert OwnerCannotBeIssuer();
        super.acceptOwnership();
    }

    /// @notice Always reverts; use two-step ownership transfer instead.
    function renounceOwnership() public override onlyOwner {
        revert RenounceOwnershipDisabled();
    }

    /// @notice Registers a current issuer's attestation for msg.sender, never another holder.
    /// @dev Domain binds chain ID and this deployment; the struct binds holder, ID,
    /// commitment, expiration, and deadline. IDs and commitments are single-use forever,
    /// including after expiration or revocation. ERC-1271 verification is read-only.
    /// @param credentialId Nonzero opaque credential identifier, containing no personal data.
    /// @param commitment Nonzero keccak256 hash of the off-chain credential document.
    /// @param expiresAt Exclusive expiration, at most MAX_VALIDITY seconds from now.
    /// @param deadline Inclusive signature deadline, at most MAX_DEADLINE_WINDOW from now.
    /// @param issuer Currently authorized signer, either an EOA or ERC-1271 wallet.
    /// @param signature Issuer signature over the EIP-712 Attestation digest.
    function registerCommitment(
        bytes32 credentialId,
        bytes32 commitment,
        uint64 expiresAt,
        uint64 deadline,
        address issuer,
        bytes calldata signature
    ) external whenNotPaused {
        if (credentialId == bytes32(0)) revert ZeroCredentialId();
        if (commitment == bytes32(0)) revert ZeroCommitment();
        if (credentials[credentialId].holder != address(0)) revert CredentialIdAlreadyUsed();
        if (commitmentToCredentialId[commitment] != bytes32(0)) revert CommitmentAlreadyUsed();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_VALIDITY) {
            revert InvalidExpiration();
        }
        _checkDeadline(deadline);
        if (!isIssuer[issuer]) revert UnauthorizedIssuer();
        if (!SignatureChecker.isValidSignatureNow(
            issuer, attestationDigest(credentialId, commitment, msg.sender, expiresAt, deadline), signature
        )) revert InvalidSignature();

        credentials[credentialId] = Credential({
            holder: msg.sender,
            issuer: issuer,
            commitment: commitment,
            expiresAt: expiresAt,
            registeredAt: uint64(block.timestamp),
            revoked: false
        });
        commitmentToCredentialId[commitment] = credentialId;
        emit CommitmentRegistered(credentialId, commitment, msg.sender, issuer, expiresAt);
    }

    /// @notice Holder, any current issuer, or owner may revoke, even while paused or expired.
    function revoke(bytes32 credentialId) external {
        Credential storage credential = _revocableCredential(credentialId);
        if (msg.sender != credential.holder && !isIssuer[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedRevoker();
        }
        credential.revoked = true;
        emit CredentialRevoked(credentialId, msg.sender);
    }

    /// @notice Anyone may relay a current issuer's revocation, including while paused.
    /// @dev A removed issuer's signature is rejected, even for its historical credentials.
    /// AlreadyRevoked prevents replay; revokedBy records the signing issuer, not msg.sender.
    /// @param credentialId Existing, not-yet-revoked credential identifier.
    /// @param deadline Inclusive signature deadline within MAX_DEADLINE_WINDOW.
    /// @param issuer Currently authorized EOA or ERC-1271 signer.
    /// @param signature Issuer signature over the EIP-712 Revocation digest.
    function revokeWithSignature(
        bytes32 credentialId, uint64 deadline, address issuer, bytes calldata signature
    ) external {
        Credential storage credential = _revocableCredential(credentialId);
        _checkDeadline(deadline);
        if (!isIssuer[issuer]) revert UnauthorizedIssuer();
        if (!SignatureChecker.isValidSignatureNow(issuer, revocationDigest(credentialId, deadline), signature)) {
            revert InvalidSignature();
        }
        credential.revoked = true;
        emit CredentialRevoked(credentialId, issuer);
    }

    /// @notice Returns None for unknown IDs; Revoked always takes precedence over Expired.
    function statusOf(bytes32 credentialId) public view returns (Status) {
        Credential storage credential = credentials[credentialId];
        if (credential.holder == address(0)) return Status.None;
        if (credential.revoked) return Status.Revoked;
        if (block.timestamp >= credential.expiresAt) return Status.Expired;
        return Status.Active;
    }

    /// @notice Whether a credential exists, is unrevoked, and has not expired.
    function isActive(bytes32 credentialId) external view returns (bool) {
        return statusOf(credentialId) == Status.Active;
    }

    /// @notice Returns the complete record, or an all-zero struct for an unknown ID.
    function getCredential(bytes32 credentialId) external view returns (Credential memory) {
        return credentials[credentialId];
    }

    /// @notice Returns the full EIP-712 Attestation digest without checking input validity.
    /// @dev Sign typed data, not an Ethereum personal_sign-prefixed version of this digest.
    function attestationDigest(
        bytes32 credentialId, bytes32 commitment, address holder, uint64 expiresAt, uint64 deadline
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            ATTESTATION_TYPEHASH, credentialId, commitment, holder, expiresAt, deadline
        )));
    }

    /// @notice Returns the full EIP-712 Revocation digest without checking input validity.
    function revocationDigest(bytes32 credentialId, uint64 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(REVOCATION_TYPEHASH, credentialId, deadline)));
    }

    /// @notice Returns the EIP-712 domain separator for this deployment and current chain ID.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @dev Enforces an inclusive deadline no more than seven days in the future.
    function _checkDeadline(uint64 deadline) private view {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (deadline > block.timestamp + MAX_DEADLINE_WINDOW) revert DeadlineTooFar();
    }

    /// @dev Resolves an existing, not-yet-revoked credential; expired records remain revocable.
    function _revocableCredential(bytes32 credentialId) private view returns (Credential storage credential) {
        credential = credentials[credentialId];
        if (credential.holder == address(0)) revert NotFound();
        if (credential.revoked) revert AlreadyRevoked();
    }
}
