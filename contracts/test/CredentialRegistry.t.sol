// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {CredentialRegistry} from "../CredentialRegistry.sol";
import {CredentialRegistryTestBase} from "./CredentialRegistry.Base.t.sol";

/// @dev Constructor, EIP-712 digests, registerCommitment, and statusOf.
contract CredentialRegistryTest is CredentialRegistryTestBase {
    // ================= constructor =================
    function test_Constructor_SetsOwnerAndIssuerSeparately() public view {
        assertEq(reg.owner(), owner);
        assertTrue(reg.isIssuer(issuer));
        assertFalse(reg.isIssuer(owner));
        assertEq(reg.issuerCount(), 1);
        assertFalse(reg.paused());
        assertEq(reg.pendingOwner(), address(0));
    }

    function test_Constructor_EmitsIssuerAdded() public {
        vm.expectEmit(true, false, false, false);
        emit IssuerAdded(issuer);
        new CredentialRegistry(owner, issuer);
    }

    function test_Constructor_RevertsWhenOwnerEqualsIssuer() public {
        vm.expectRevert(CredentialRegistry.InitialRolesMustDiffer.selector);
        new CredentialRegistry(owner, owner);
    }

    function test_Constructor_RevertsOnZeroIssuer() public {
        vm.expectRevert(CredentialRegistry.ZeroAddress.selector);
        new CredentialRegistry(owner, address(0));
    }

    function test_Constructor_RevertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new CredentialRegistry(address(0), issuer);
    }

    function test_Constants() public view {
        assertEq(reg.MAX_VALIDITY(), 730 days);
        assertEq(reg.MAX_DEADLINE_WINDOW(), 7 days);
    }

    // ================= EIP-712 digests =================
    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("PostcodeProof Credential Registry")),
                keccak256(bytes("1")),
                block.chainid,
                address(reg)
            )
        );
    }

    function test_Digest_DomainSeparatorMatchesIndependent() public view {
        assertEq(reg.domainSeparator(), _domainSeparator());
    }

    function test_Digest_AttestationMatchesIndependentRecomputation() public view {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Attestation(bytes32 credentialId,bytes32 commitment,address holder,uint64 expiresAt,uint64 deadline)"
                ),
                ID1,
                C1,
                holder,
                exp,
                dl
            )
        );
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        assertEq(reg.attestationDigest(ID1, C1, holder, exp, dl), expected);
    }

    function test_Digest_RevocationMatchesIndependentRecomputation() public view {
        bytes32 structHash =
            keccak256(abi.encode(keccak256("Revocation(bytes32 credentialId,uint64 deadline)"), ID1, dl));
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        assertEq(reg.revocationDigest(ID1, dl), expected);
    }

    function test_Digest_TypehashesMatchSchema() public view {
        assertEq(
            reg.ATTESTATION_TYPEHASH(),
            keccak256(
                "Attestation(bytes32 credentialId,bytes32 commitment,address holder,uint64 expiresAt,uint64 deadline)"
            )
        );
        assertEq(reg.REVOCATION_TYPEHASH(), keccak256("Revocation(bytes32 credentialId,uint64 deadline)"));
    }

    function test_Digest_ChangesWithEveryField() public view {
        bytes32 base = reg.attestationDigest(ID1, C1, holder, exp, dl);
        assertNotEq(base, reg.attestationDigest(ID2, C1, holder, exp, dl));
        assertNotEq(base, reg.attestationDigest(ID1, C2, holder, exp, dl));
        assertNotEq(base, reg.attestationDigest(ID1, C1, holder2, exp, dl));
        assertNotEq(base, reg.attestationDigest(ID1, C1, holder, exp + 1, dl));
        assertNotEq(base, reg.attestationDigest(ID1, C1, holder, exp, dl + 1));
    }

    function test_Digest_ChangesWithChainId() public {
        bytes32 before_ = reg.attestationDigest(ID1, C1, holder, exp, dl);
        vm.chainId(block.chainid + 1);
        assertNotEq(before_, reg.attestationDigest(ID1, C1, holder, exp, dl));
        assertEq(reg.domainSeparator(), _domainSeparator());
    }

    // ================= registerCommitment: happy path =================
    function test_Register_StoresCredentialAndIndexes() public {
        _registerDefault();
        CredentialRegistry.Credential memory c = reg.getCredential(ID1);
        assertEq(c.holder, holder);
        assertEq(c.issuer, issuer);
        assertEq(c.commitment, C1);
        assertEq(c.expiresAt, exp);
        assertEq(c.registeredAt, uint64(T0));
        assertFalse(c.revoked);
        assertEq(reg.commitmentToCredentialId(C1), ID1);
        assertEq(uint8(reg.statusOf(ID1)), uint8(CredentialRegistry.Status.Active));
        assertTrue(reg.isActive(ID1));
    }

    function test_Register_EmitsCommitmentRegistered() public {
        bytes memory s = _defaultSig();
        vm.expectEmit(true, true, true, true, address(reg));
        emit CommitmentRegistered(ID1, C1, holder, issuer, exp);
        vm.prank(holder);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
    }

    function test_Register_PublicMappingGettersMatch() public {
        _registerDefault();
        (address h, address i, bytes32 cm, uint64 e, uint64 r, bool rev) = reg.credentials(ID1);
        assertEq(h, holder);
        assertEq(i, issuer);
        assertEq(cm, C1);
        assertEq(e, exp);
        assertEq(r, uint64(T0));
        assertFalse(rev);
    }

    function test_Register_SecondCredentialIndependent() public {
        _registerDefault();
        _register(ID2, C2, holder2);
        assertEq(reg.getCredential(ID2).holder, holder2);
        assertEq(reg.commitmentToCredentialId(C2), ID2);
        assertEq(reg.getCredential(ID1).holder, holder);
    }

    function test_Register_SecondIssuerCanSign() public {
        vm.prank(owner);
        reg.addIssuer(issuer2);
        bytes memory s = _attSig(ISSUER2_PK, reg, ID1, C1, holder, exp, dl);
        vm.prank(holder);
        reg.registerCommitment(ID1, C1, exp, dl, issuer2, s);
        assertEq(reg.getCredential(ID1).issuer, issuer2);
    }

    function test_Register_RelayerNotHolderCannotUseHoldersSignature() public {
        bytes memory s = _defaultSig();
        vm.prank(relayer);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
    }

    // ================= registerCommitment: reverts =================
    function test_Register_RevertsDuplicateCredentialId() public {
        _registerDefault();
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C2, holder, exp, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.CredentialIdAlreadyUsed.selector);
        reg.registerCommitment(ID1, C2, exp, dl, issuer, s);
    }

    function test_Register_RevertsDuplicateCommitment() public {
        _registerDefault();
        bytes memory s = _attSig(ISSUER_PK, reg, ID2, C1, holder2, exp, dl);
        vm.prank(holder2);
        vm.expectRevert(CredentialRegistry.CommitmentAlreadyUsed.selector);
        reg.registerCommitment(ID2, C1, exp, dl, issuer, s);
    }

    function test_Register_RevertsUnauthorizedIssuer() public {
        bytes memory s = _attSig(STRANGER_PK, reg, ID1, C1, holder, exp, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.UnauthorizedIssuer.selector);
        reg.registerCommitment(ID1, C1, exp, dl, stranger, s);
    }

    function test_Register_RevertsInvalidSignature_Garbage() public {
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, hex"deadbeef");
    }

    function test_Register_RevertsInvalidSignature_Empty() public {
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, "");
    }

    function test_Register_RevertsSignatureFromNonIssuerKeyClaimingIssuer() public {
        // Signed by a stranger key but submitted with the real issuer address.
        bytes memory s = _attSig(STRANGER_PK, reg, ID1, C1, holder, exp, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
    }

    function test_Register_RevertsSignatureBoundToAnotherHolder() public {
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder2, exp, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
    }

    function test_Register_RevertsSignatureBoundToAnotherCredentialId() public {
        bytes memory s = _attSig(ISSUER_PK, reg, ID2, C1, holder, exp, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
    }

    function test_Register_RevertsSignatureBoundToAnotherCommitment() public {
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C2, holder, exp, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
    }

    function test_Register_RevertsSignatureBoundToAnotherExpiry() public {
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, exp - 1, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
    }

    function test_Register_RevertsSignatureBoundToAnotherDeadline() public {
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, exp, dl + 1);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
    }

    function test_Register_ReplayOnAnotherChainReverts() public {
        bytes memory s = _defaultSig();
        vm.chainId(block.chainid + 1);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
    }

    function test_Register_ReplayOnAnotherDeploymentReverts() public {
        CredentialRegistry other = new CredentialRegistry(owner, issuer);
        bytes memory s = _defaultSig(); // bound to `reg`
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        other.registerCommitment(ID1, C1, exp, dl, issuer, s);
        // and the original still accepts it
        vm.prank(holder);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
    }

    function test_Register_RevertsExpiredDeadline() public {
        uint64 d = uint64(T0 - 1);
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, exp, d);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.DeadlineExpired.selector);
        reg.registerCommitment(ID1, C1, exp, d, issuer, s);
    }

    function test_Register_RevertsAfterDeadlineElapsesViaWarp() public {
        bytes memory s = _defaultSig();
        vm.warp(uint256(dl) + 1);
        // keep expiry valid relative to new time
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.DeadlineExpired.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
    }

    function test_Register_DeadlineEqualNowIsAccepted() public {
        uint64 d = uint64(T0);
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, exp, d);
        vm.prank(holder);
        reg.registerCommitment(ID1, C1, exp, d, issuer, s);
        assertTrue(reg.isActive(ID1));
    }

    function test_Register_DeadlineAtMaxWindowAccepted() public {
        uint64 d = uint64(T0 + 7 days);
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, exp, d);
        vm.prank(holder);
        reg.registerCommitment(ID1, C1, exp, d, issuer, s);
        assertTrue(reg.isActive(ID1));
    }

    function test_Register_RevertsDeadlineTooFar() public {
        uint64 d = uint64(T0 + 7 days + 1);
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, exp, d);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.DeadlineTooFar.selector);
        reg.registerCommitment(ID1, C1, exp, d, issuer, s);
    }

    function test_Register_RevertsExpiresAtInPast() public {
        uint64 e = uint64(T0 - 1);
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, e, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidExpiration.selector);
        reg.registerCommitment(ID1, C1, e, dl, issuer, s);
    }

    function test_Register_RevertsExpiresAtEqualsNow() public {
        uint64 e = uint64(T0);
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, e, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidExpiration.selector);
        reg.registerCommitment(ID1, C1, e, dl, issuer, s);
    }

    function test_Register_ExpiresAtMaxValidityAccepted() public {
        uint64 e = uint64(T0 + 730 days);
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, e, dl);
        vm.prank(holder);
        reg.registerCommitment(ID1, C1, e, dl, issuer, s);
        assertEq(reg.getCredential(ID1).expiresAt, e);
    }

    function test_Register_RevertsExpiresAtTooFar() public {
        uint64 e = uint64(T0 + 730 days + 1);
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, e, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidExpiration.selector);
        reg.registerCommitment(ID1, C1, e, dl, issuer, s);
    }

    function test_Register_RevertsZeroCredentialId() public {
        bytes memory s = _attSig(ISSUER_PK, reg, bytes32(0), C1, holder, exp, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.ZeroCredentialId.selector);
        reg.registerCommitment(bytes32(0), C1, exp, dl, issuer, s);
    }

    function test_Register_RevertsZeroCommitment() public {
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, bytes32(0), holder, exp, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.ZeroCommitment.selector);
        reg.registerCommitment(ID1, bytes32(0), exp, dl, issuer, s);
    }

    function test_Register_RevertsZeroExpiresAt() public {
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, 0, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidExpiration.selector);
        reg.registerCommitment(ID1, C1, 0, dl, issuer, s);
    }

    function test_Register_RevertsZeroDeadline() public {
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, exp, 0);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.DeadlineExpired.selector);
        reg.registerCommitment(ID1, C1, exp, 0, issuer, s);
    }

    function test_Register_RevertsZeroIssuerAddress() public {
        bytes memory s = _defaultSig();
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.UnauthorizedIssuer.selector);
        reg.registerCommitment(ID1, C1, exp, dl, address(0), s);
    }

    function test_Register_RevertsWhenPaused() public {
        bytes memory s = _defaultSig();
        vm.prank(owner);
        reg.pause();
        vm.prank(holder);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
    }

    function test_Register_WorksAgainAfterUnpause() public {
        bytes memory s = _defaultSig();
        vm.startPrank(owner);
        reg.pause();
        reg.unpause();
        vm.stopPrank();
        vm.prank(holder);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
        assertTrue(reg.isActive(ID1));
    }

    function test_Register_FailedAttemptLeavesNoState() public {
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, hex"00");
        assertEq(reg.commitmentToCredentialId(C1), bytes32(0));
        assertEq(uint8(reg.statusOf(ID1)), uint8(CredentialRegistry.Status.None));
    }

    // ================= statusOf =================
    function test_Status_UnknownIsNone() public view {
        assertEq(uint8(reg.statusOf(ID1)), uint8(CredentialRegistry.Status.None));
        assertFalse(reg.isActive(ID1));
        CredentialRegistry.Credential memory c = reg.getCredential(ID1);
        assertEq(c.holder, address(0));
        assertEq(c.expiresAt, 0);
    }

    function test_Status_ActiveUntilExpiryThenExpired() public {
        _registerDefault();
        vm.warp(uint256(exp) - 1);
        assertEq(uint8(reg.statusOf(ID1)), uint8(CredentialRegistry.Status.Active));
        vm.warp(uint256(exp)); // exclusive end
        assertEq(uint8(reg.statusOf(ID1)), uint8(CredentialRegistry.Status.Expired));
        assertFalse(reg.isActive(ID1));
        vm.warp(uint256(exp) + 100 days);
        assertEq(uint8(reg.statusOf(ID1)), uint8(CredentialRegistry.Status.Expired));
    }

    function test_Status_ExpiredCredentialIdAndCommitmentStayUsed() public {
        _registerDefault();
        vm.warp(uint256(exp) + 1);
        bytes32 id3 = keccak256("id3");
        uint64 e2 = uint64(block.timestamp + 30 days);
        uint64 d2 = uint64(block.timestamp + 1 days);
        bytes memory s = _attSig(ISSUER_PK, reg, id3, C1, holder, e2, d2);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.CommitmentAlreadyUsed.selector);
        reg.registerCommitment(id3, C1, e2, d2, issuer, s);
    }
}
