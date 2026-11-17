// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CredentialRegistry} from "../CredentialRegistry.sol";
import {CredentialRegistryTestBase} from "./CredentialRegistry.Base.t.sol";

/// @dev revoke / revokeWithSignature and their interaction with issuer rotation, pause, expiry.
contract CredentialRegistryRevokeTest is CredentialRegistryTestBase {
    function setUp() public override {
        super.setUp();
        _registerDefault();
    }

    function _status() internal view returns (CredentialRegistry.Status) {
        return reg.statusOf(ID1);
    }

    // ================= revoke =================
    function test_Revoke_ByHolder() public {
        vm.expectEmit(true, true, false, false, address(reg));
        emit CredentialRevoked(ID1, holder);
        vm.prank(holder);
        reg.revoke(ID1);
        assertEq(uint8(_status()), uint8(CredentialRegistry.Status.Revoked));
        assertTrue(reg.getCredential(ID1).revoked);
        assertFalse(reg.isActive(ID1));
    }

    function test_Revoke_ByIssuer() public {
        vm.expectEmit(true, true, false, false, address(reg));
        emit CredentialRevoked(ID1, issuer);
        vm.prank(issuer);
        reg.revoke(ID1);
        assertEq(uint8(_status()), uint8(CredentialRegistry.Status.Revoked));
    }

    function test_Revoke_ByAnyCurrentIssuerNotJustOriginal() public {
        vm.prank(owner);
        reg.addIssuer(issuer2);
        vm.prank(issuer2);
        reg.revoke(ID1);
        assertEq(uint8(_status()), uint8(CredentialRegistry.Status.Revoked));
    }

    function test_Revoke_ByOwner() public {
        vm.expectEmit(true, true, false, false, address(reg));
        emit CredentialRevoked(ID1, owner);
        vm.prank(owner);
        reg.revoke(ID1);
        assertEq(uint8(_status()), uint8(CredentialRegistry.Status.Revoked));
    }

    function test_Revoke_OutsiderFails() public {
        vm.prank(outsider);
        vm.expectRevert(CredentialRegistry.UnauthorizedRevoker.selector);
        reg.revoke(ID1);
        assertEq(uint8(_status()), uint8(CredentialRegistry.Status.Active));
    }

    function test_Revoke_OtherHolderFails() public {
        vm.prank(holder2);
        vm.expectRevert(CredentialRegistry.UnauthorizedRevoker.selector);
        reg.revoke(ID1);
    }

    function test_Revoke_RemovedIssuerFails() public {
        vm.startPrank(owner);
        reg.addIssuer(issuer2);
        reg.removeIssuer(issuer);
        vm.stopPrank();
        vm.prank(issuer);
        vm.expectRevert(CredentialRegistry.UnauthorizedRevoker.selector);
        reg.revoke(ID1);
    }

    function test_Revoke_UnknownIdReverts() public {
        vm.prank(owner);
        vm.expectRevert(CredentialRegistry.NotFound.selector);
        reg.revoke(ID2);
    }

    function test_Revoke_AlreadyRevokedReverts() public {
        vm.prank(holder);
        reg.revoke(ID1);
        vm.prank(owner);
        vm.expectRevert(CredentialRegistry.AlreadyRevoked.selector);
        reg.revoke(ID1);
    }

    function test_Revoke_NotFoundTakesPrecedenceOverAuth() public {
        vm.prank(outsider);
        vm.expectRevert(CredentialRegistry.NotFound.selector);
        reg.revoke(ID2);
    }

    function test_Revoke_ExpiredCredentialCanStillBeRevoked() public {
        vm.warp(uint256(exp) + 1);
        assertEq(uint8(_status()), uint8(CredentialRegistry.Status.Expired));
        vm.prank(holder);
        reg.revoke(ID1);
        assertEq(uint8(_status()), uint8(CredentialRegistry.Status.Revoked));
    }

    function test_Revoke_RevokedTakesPrecedenceOverExpiredAfterWarp() public {
        vm.prank(holder);
        reg.revoke(ID1);
        vm.warp(uint256(exp) + 1);
        assertEq(uint8(_status()), uint8(CredentialRegistry.Status.Revoked));
    }

    function test_Revoke_WorksWhilePaused() public {
        vm.prank(owner);
        reg.pause();
        vm.prank(holder);
        reg.revoke(ID1);
        assertEq(uint8(_status()), uint8(CredentialRegistry.Status.Revoked));
    }

    function test_Revoke_DoesNotFreeIdOrCommitment() public {
        vm.prank(holder);
        reg.revoke(ID1);
        // same id, new commitment
        bytes memory s1 = _attSig(ISSUER_PK, reg, ID1, C2, holder, exp, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.CredentialIdAlreadyUsed.selector);
        reg.registerCommitment(ID1, C2, exp, dl, issuer, s1);
        // new id, same commitment
        bytes memory s2 = _attSig(ISSUER_PK, reg, ID2, C1, holder, exp, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.CommitmentAlreadyUsed.selector);
        reg.registerCommitment(ID2, C1, exp, dl, issuer, s2);
    }

    // ================= revokeWithSignature =================
    function test_RevokeWithSig_ValidByRelayer() public {
        bytes memory s = _revSig(ISSUER_PK, ID1, dl);
        vm.expectEmit(true, true, false, false, address(reg));
        emit CredentialRevoked(ID1, issuer); // revokedBy is signer, not relayer
        vm.prank(relayer);
        reg.revokeWithSignature(ID1, dl, issuer, s);
        assertEq(uint8(_status()), uint8(CredentialRegistry.Status.Revoked));
    }

    function test_RevokeWithSig_ReplayReverts() public {
        bytes memory s = _revSig(ISSUER_PK, ID1, dl);
        reg.revokeWithSignature(ID1, dl, issuer, s);
        vm.expectRevert(CredentialRegistry.AlreadyRevoked.selector);
        reg.revokeWithSignature(ID1, dl, issuer, s);
    }

    function test_RevokeWithSig_WrongIssuerKeyReverts() public {
        // signed by stranger, claiming the authorized issuer address
        bytes memory s = _revSig(STRANGER_PK, ID1, dl);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.revokeWithSignature(ID1, dl, issuer, s);
    }

    function test_RevokeWithSig_UnauthorizedIssuerAddressReverts() public {
        bytes memory s = _revSig(STRANGER_PK, ID1, dl);
        vm.expectRevert(CredentialRegistry.UnauthorizedIssuer.selector);
        reg.revokeWithSignature(ID1, dl, stranger, s);
    }

    function test_RevokeWithSig_RemovedIssuerSignatureRejected() public {
        bytes memory s = _revSig(ISSUER_PK, ID1, dl);
        vm.startPrank(owner);
        reg.addIssuer(issuer2);
        reg.removeIssuer(issuer);
        vm.stopPrank();
        vm.expectRevert(CredentialRegistry.UnauthorizedIssuer.selector);
        reg.revokeWithSignature(ID1, dl, issuer, s);
    }

    function test_RevokeWithSig_SecondIssuerCanRevokeOthersCredential() public {
        vm.prank(owner);
        reg.addIssuer(issuer2);
        bytes memory s = _revSig(ISSUER2_PK, ID1, dl);
        reg.revokeWithSignature(ID1, dl, issuer2, s);
        assertEq(uint8(_status()), uint8(CredentialRegistry.Status.Revoked));
    }

    function test_RevokeWithSig_ExpiredDeadlineReverts() public {
        uint64 d = uint64(T0 + 1 hours);
        bytes memory s = _revSig(ISSUER_PK, ID1, d);
        vm.warp(uint256(d) + 1);
        vm.expectRevert(CredentialRegistry.DeadlineExpired.selector);
        reg.revokeWithSignature(ID1, d, issuer, s);
    }

    function test_RevokeWithSig_DeadlineTooFarReverts() public {
        uint64 d = uint64(T0 + 7 days + 1);
        bytes memory s = _revSig(ISSUER_PK, ID1, d);
        vm.expectRevert(CredentialRegistry.DeadlineTooFar.selector);
        reg.revokeWithSignature(ID1, d, issuer, s);
    }

    function test_RevokeWithSig_DeadlineBoundariesAccepted() public {
        bytes32 idB = keccak256("boundary");
        bytes32 cB = keccak256("boundary-c");
        _register(idB, cB, holder2);
        uint64 dNow = uint64(T0);
        reg.revokeWithSignature(idB, dNow, issuer, _revSig(ISSUER_PK, idB, dNow));
        uint64 dMax = uint64(T0 + 7 days);
        reg.revokeWithSignature(ID1, dMax, issuer, _revSig(ISSUER_PK, ID1, dMax));
        assertEq(uint8(reg.statusOf(idB)), uint8(CredentialRegistry.Status.Revoked));
        assertEq(uint8(_status()), uint8(CredentialRegistry.Status.Revoked));
    }

    function test_RevokeWithSig_UnknownIdReverts() public {
        bytes memory s = _revSig(ISSUER_PK, ID2, dl);
        vm.expectRevert(CredentialRegistry.NotFound.selector);
        reg.revokeWithSignature(ID2, dl, issuer, s);
    }

    function test_RevokeWithSig_AlreadyRevokedByDirectCallReverts() public {
        vm.prank(holder);
        reg.revoke(ID1);
        bytes memory s = _revSig(ISSUER_PK, ID1, dl);
        vm.expectRevert(CredentialRegistry.AlreadyRevoked.selector);
        reg.revokeWithSignature(ID1, dl, issuer, s);
    }

    function test_RevokeWithSig_SignatureForOtherCredentialReverts() public {
        _register(ID2, C2, holder2);
        bytes memory s = _revSig(ISSUER_PK, ID2, dl);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.revokeWithSignature(ID1, dl, issuer, s);
        assertEq(uint8(_status()), uint8(CredentialRegistry.Status.Active));
    }

    function test_RevokeWithSig_SignatureForOtherDeadlineReverts() public {
        bytes memory s = _revSig(ISSUER_PK, ID1, dl + 1);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.revokeWithSignature(ID1, dl, issuer, s);
    }

    function test_RevokeWithSig_AttestationSignatureNotReusableAsRevocation() public {
        bytes memory s = _defaultSig();
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.revokeWithSignature(ID1, dl, issuer, s);
    }

    function test_RevokeWithSig_GarbageSignatureReverts() public {
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.revokeWithSignature(ID1, dl, issuer, hex"1234");
    }

    function test_RevokeWithSig_ReplayOnOtherChainReverts() public {
        bytes memory s = _revSig(ISSUER_PK, ID1, dl);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.revokeWithSignature(ID1, dl, issuer, s);
    }

    function test_RevokeWithSig_ReplayOnOtherDeploymentReverts() public {
        CredentialRegistry other = new CredentialRegistry(owner, issuer);
        bytes memory s = _revSig(ISSUER_PK, ID1, dl); // bound to reg
        _otherRegisterAndRevoke(other, s);
    }

    function _otherRegisterAndRevoke(CredentialRegistry other, bytes memory revSig) internal {
        bytes memory a = _attSig(ISSUER_PK, other, ID1, C1, holder, exp, dl);
        vm.prank(holder);
        other.registerCommitment(ID1, C1, exp, dl, issuer, a);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        other.revokeWithSignature(ID1, dl, issuer, revSig);
    }

    function test_RevokeWithSig_WorksWhilePaused() public {
        vm.prank(owner);
        reg.pause();
        reg.revokeWithSignature(ID1, dl, issuer, _revSig(ISSUER_PK, ID1, dl));
        assertEq(uint8(_status()), uint8(CredentialRegistry.Status.Revoked));
    }

    function test_RevokeWithSig_ExpiredCredentialStillRevocable() public {
        vm.warp(uint256(exp) + 1);
        uint64 d = uint64(block.timestamp + 1 days);
        reg.revokeWithSignature(ID1, d, issuer, _revSig(ISSUER_PK, ID1, d));
        assertEq(uint8(_status()), uint8(CredentialRegistry.Status.Revoked));
    }
}
