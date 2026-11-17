// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CredentialRegistry} from "../CredentialRegistry.sol";

/// @dev Shared fixtures/helpers. Contains no test functions.
abstract contract CredentialRegistryTestBase is Test {
    CredentialRegistry internal reg;

    uint256 internal constant ISSUER_PK = 0xA11CE0001;
    uint256 internal constant ISSUER2_PK = 0xB0B0002;
    uint256 internal constant STRANGER_PK = 0xDEAD0003;

    address internal owner = makeAddr("owner");
    address internal holder = makeAddr("holder");
    address internal holder2 = makeAddr("holder2");
    address internal outsider = makeAddr("outsider");
    address internal relayer = makeAddr("relayer");
    address internal issuer;
    address internal issuer2;
    address internal stranger; // key-holder that is NOT an authorized issuer

    uint256 internal constant T0 = 1_700_000_000;
    bytes32 internal constant ID1 = keccak256("credential-1");
    bytes32 internal constant ID2 = keccak256("credential-2");
    bytes32 internal constant C1 = keccak256("commitment-1");
    bytes32 internal constant C2 = keccak256("commitment-2");

    uint64 internal exp; // T0 + 365 days
    uint64 internal dl; // T0 + 1 day

    event IssuerAdded(address indexed issuer);
    event IssuerRemoved(address indexed issuer);
    event IssuerRotated(address indexed oldIssuer, address indexed newIssuer);
    event CommitmentRegistered(
        bytes32 indexed credentialId,
        bytes32 indexed commitment,
        address indexed holder,
        address issuer,
        uint64 expiresAt
    );
    event CredentialRevoked(bytes32 indexed credentialId, address indexed revokedBy);

    function setUp() public virtual {
        vm.warp(T0);
        issuer = vm.addr(ISSUER_PK);
        issuer2 = vm.addr(ISSUER2_PK);
        stranger = vm.addr(STRANGER_PK);
        exp = uint64(T0 + 365 days);
        dl = uint64(T0 + 1 days);
        reg = new CredentialRegistry(owner, issuer);
    }

    // ---------- helpers ----------
    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _attSig(
        uint256 pk,
        CredentialRegistry r,
        bytes32 id,
        bytes32 commitment,
        address h,
        uint64 e,
        uint64 d
    ) internal view returns (bytes memory) {
        return _sig(pk, r.attestationDigest(id, commitment, h, e, d));
    }

    /// @dev Default-issuer attestation for (ID1, C1, holder, exp, dl).
    function _defaultSig() internal view returns (bytes memory) {
        return _attSig(ISSUER_PK, reg, ID1, C1, holder, exp, dl);
    }

    function _revSig(uint256 pk, bytes32 id, uint64 d) internal view returns (bytes memory) {
        return _sig(pk, reg.revocationDigest(id, d));
    }

    /// @dev Registers id/commitment for `h` with the default issuer, using current exp/dl.
    function _register(bytes32 id, bytes32 commitment, address h) internal {
        bytes memory s = _attSig(ISSUER_PK, reg, id, commitment, h, exp, dl);
        vm.prank(h);
        reg.registerCommitment(id, commitment, exp, dl, issuer, s);
    }

    function _registerDefault() internal {
        _register(ID1, C1, holder);
    }
}
