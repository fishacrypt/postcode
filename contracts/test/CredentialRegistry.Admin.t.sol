// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {CredentialRegistry} from "../CredentialRegistry.sol";
import {CredentialRegistryTestBase} from "./CredentialRegistry.Base.t.sol";

/// @dev Issuer management, ownership, pause, and access control.
contract CredentialRegistryAdminTest is CredentialRegistryTestBase {
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address account);
    event Unpaused(address account);

    function _unauth(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who);
    }

    // ================= addIssuer =================
    function test_AddIssuer_Works() public {
        vm.expectEmit(true, false, false, false, address(reg));
        emit IssuerAdded(issuer2);
        vm.prank(owner);
        reg.addIssuer(issuer2);
        assertTrue(reg.isIssuer(issuer2));
        assertEq(reg.issuerCount(), 2);
    }

    function test_AddIssuer_RevertsZero() public {
        vm.prank(owner);
        vm.expectRevert(CredentialRegistry.ZeroAddress.selector);
        reg.addIssuer(address(0));
    }

    function test_AddIssuer_RevertsDuplicate() public {
        vm.prank(owner);
        vm.expectRevert(CredentialRegistry.IssuerAlreadyExists.selector);
        reg.addIssuer(issuer);
    }

    function test_AddIssuer_RevertsWhenIssuerIsOwner() public {
        vm.prank(owner);
        vm.expectRevert(CredentialRegistry.OwnerCannotBeIssuer.selector);
        reg.addIssuer(owner);
        assertFalse(reg.isIssuer(owner));
        assertEq(reg.issuerCount(), 1);
    }

    function test_AddIssuer_PreviousOwnerCanBeAddedAfterOwnershipTransfer() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        reg.transferOwnership(newOwner);
        vm.prank(newOwner);
        reg.acceptOwnership();

        // the old owner is no longer owner(), so it may now be an issuer
        vm.prank(newOwner);
        reg.addIssuer(owner);
        assertTrue(reg.isIssuer(owner));

        // the new owner is now blocked
        vm.prank(newOwner);
        vm.expectRevert(CredentialRegistry.OwnerCannotBeIssuer.selector);
        reg.addIssuer(newOwner);
    }

    // ================= removeIssuer =================
    function test_RemoveIssuer_Works() public {
        vm.startPrank(owner);
        reg.addIssuer(issuer2);
        vm.expectEmit(true, false, false, false, address(reg));
        emit IssuerRemoved(issuer);
        reg.removeIssuer(issuer);
        vm.stopPrank();
        assertFalse(reg.isIssuer(issuer));
        assertEq(reg.issuerCount(), 1);
    }

    function test_RemoveIssuer_RevertsLastIssuer() public {
        vm.prank(owner);
        vm.expectRevert(CredentialRegistry.LastIssuer.selector);
        reg.removeIssuer(issuer);
        assertEq(reg.issuerCount(), 1);
    }

    function test_RemoveIssuer_RevertsUnknown() public {
        vm.prank(owner);
        vm.expectRevert(CredentialRegistry.UnauthorizedIssuer.selector);
        reg.removeIssuer(issuer2);
    }

    function test_RemoveIssuer_RevertsZero() public {
        vm.prank(owner);
        vm.expectRevert(CredentialRegistry.UnauthorizedIssuer.selector);
        reg.removeIssuer(address(0));
    }

    function test_RemoveIssuer_CannotRemoveTwice() public {
        vm.startPrank(owner);
        reg.addIssuer(issuer2);
        reg.removeIssuer(issuer);
        vm.expectRevert(CredentialRegistry.UnauthorizedIssuer.selector);
        reg.removeIssuer(issuer);
        vm.stopPrank();
    }

    function test_RemoveIssuer_RemovedIssuerCannotSignNewAttestations() public {
        vm.startPrank(owner);
        reg.addIssuer(issuer2);
        reg.removeIssuer(issuer);
        vm.stopPrank();
        bytes memory s = _defaultSig();
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.UnauthorizedIssuer.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
    }

    // ================= rotateIssuer =================
    function test_Rotate_Works() public {
        vm.expectEmit(true, true, false, false, address(reg));
        emit IssuerRotated(issuer, issuer2);
        vm.prank(owner);
        reg.rotateIssuer(issuer, issuer2);
        assertFalse(reg.isIssuer(issuer));
        assertTrue(reg.isIssuer(issuer2));
        assertEq(reg.issuerCount(), 1);
    }

    function test_Rotate_LastIssuerAllowed() public {
        assertEq(reg.issuerCount(), 1);
        vm.prank(owner);
        reg.rotateIssuer(issuer, issuer2);
        assertEq(reg.issuerCount(), 1);
    }

    function test_Rotate_RevertsZeroOld() public {
        vm.prank(owner);
        vm.expectRevert(CredentialRegistry.ZeroAddress.selector);
        reg.rotateIssuer(address(0), issuer2);
    }

    function test_Rotate_RevertsZeroNew() public {
        vm.prank(owner);
        vm.expectRevert(CredentialRegistry.ZeroAddress.selector);
        reg.rotateIssuer(issuer, address(0));
    }

    function test_Rotate_RevertsWhenNewIssuerIsOwner() public {
        vm.prank(owner);
        vm.expectRevert(CredentialRegistry.OwnerCannotBeIssuer.selector);
        reg.rotateIssuer(issuer, owner);
        assertTrue(reg.isIssuer(issuer));
        assertFalse(reg.isIssuer(owner));
        assertEq(reg.issuerCount(), 1);
    }

    function test_Rotate_RevertsIdentical() public {
        vm.prank(owner);
        vm.expectRevert(CredentialRegistry.IdenticalIssuers.selector);
        reg.rotateIssuer(issuer, issuer);
    }

    function test_Rotate_RevertsOldNotIssuer() public {
        vm.prank(owner);
        vm.expectRevert(CredentialRegistry.UnauthorizedIssuer.selector);
        reg.rotateIssuer(issuer2, stranger);
    }

    function test_Rotate_RevertsNewAlreadyIssuer() public {
        vm.startPrank(owner);
        reg.addIssuer(issuer2);
        vm.expectRevert(CredentialRegistry.IssuerAlreadyExists.selector);
        reg.rotateIssuer(issuer, issuer2);
        vm.stopPrank();
    }

    function test_Rotate_RotatedIssuerCannotSignNewAttestationsButOldCredentialsStayActive() public {
        _registerDefault();
        vm.prank(owner);
        reg.rotateIssuer(issuer, issuer2);

        // old credential unaffected
        assertTrue(reg.isActive(ID1));
        assertEq(reg.getCredential(ID1).issuer, issuer);

        // old issuer cannot sign new attestation
        bytes memory oldSig = _attSig(ISSUER_PK, reg, ID2, C2, holder2, exp, dl);
        vm.prank(holder2);
        vm.expectRevert(CredentialRegistry.UnauthorizedIssuer.selector);
        reg.registerCommitment(ID2, C2, exp, dl, issuer, oldSig);

        // new issuer can
        bytes memory newSig = _attSig(ISSUER2_PK, reg, ID2, C2, holder2, exp, dl);
        vm.prank(holder2);
        reg.registerCommitment(ID2, C2, exp, dl, issuer2, newSig);
        assertTrue(reg.isActive(ID2));
        assertTrue(reg.isActive(ID1));
    }

    function test_Rotate_OldIssuerLosesRevokePower() public {
        _registerDefault();
        vm.prank(owner);
        reg.rotateIssuer(issuer, issuer2);
        vm.prank(issuer);
        vm.expectRevert(CredentialRegistry.UnauthorizedRevoker.selector);
        reg.revoke(ID1);
        vm.prank(issuer2);
        reg.revoke(ID1);
        assertFalse(reg.isActive(ID1));
    }

    // ================= Ownable2Step =================
    function test_Ownership_TransferIsTwoStep() public {
        address newOwner = makeAddr("newOwner");
        vm.expectEmit(true, true, false, false, address(reg));
        emit OwnershipTransferStarted(owner, newOwner);
        vm.prank(owner);
        reg.transferOwnership(newOwner);
        assertEq(reg.owner(), owner);
        assertEq(reg.pendingOwner(), newOwner);

        vm.expectEmit(true, true, false, false, address(reg));
        emit OwnershipTransferred(owner, newOwner);
        vm.prank(newOwner);
        reg.acceptOwnership();
        assertEq(reg.owner(), newOwner);
        assertEq(reg.pendingOwner(), address(0));

        // old owner loses power, new owner gains it
        vm.prank(owner);
        vm.expectRevert(_unauth(owner));
        reg.pause();
        vm.prank(newOwner);
        reg.pause();
        assertTrue(reg.paused());
    }

    function test_Ownership_PendingOwnerHasNoPowersBeforeAccept() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        reg.transferOwnership(newOwner);
        vm.prank(newOwner);
        vm.expectRevert(_unauth(newOwner));
        reg.addIssuer(issuer2);
    }

    function test_Ownership_WrongAcceptorReverts() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        reg.transferOwnership(newOwner);
        vm.prank(outsider);
        vm.expectRevert(_unauth(outsider));
        reg.acceptOwnership();
        assertEq(reg.owner(), owner);
        assertEq(reg.pendingOwner(), newOwner);
    }

    function test_Ownership_AcceptWithoutPendingReverts() public {
        vm.prank(outsider);
        vm.expectRevert(_unauth(outsider));
        reg.acceptOwnership();
    }

    function test_Ownership_TransferOnlyOwner() public {
        vm.prank(outsider);
        vm.expectRevert(_unauth(outsider));
        reg.transferOwnership(outsider);
    }

    function test_Ownership_OwnerCanOverridePendingTransfer() public {
        address a = makeAddr("a");
        address b = makeAddr("b");
        vm.startPrank(owner);
        reg.transferOwnership(a);
        reg.transferOwnership(b);
        vm.stopPrank();
        vm.prank(a);
        vm.expectRevert(_unauth(a));
        reg.acceptOwnership();
        vm.prank(b);
        reg.acceptOwnership();
        assertEq(reg.owner(), b);
    }

    function test_Ownership_IssuerCannotAcceptOwnership() public {
        vm.prank(owner);
        reg.transferOwnership(issuer);
        vm.prank(issuer);
        vm.expectRevert(CredentialRegistry.OwnerCannotBeIssuer.selector);
        reg.acceptOwnership();
        assertEq(reg.owner(), owner);
        assertEq(reg.pendingOwner(), issuer);
    }

    function test_Ownership_PendingOwnerBecameIssuerAfterNominationCannotAccept() public {
        address newOwner = makeAddr("newOwner");
        vm.startPrank(owner);
        reg.transferOwnership(newOwner);
        reg.addIssuer(newOwner);
        vm.stopPrank();

        vm.prank(newOwner);
        vm.expectRevert(CredentialRegistry.OwnerCannotBeIssuer.selector);
        reg.acceptOwnership();
        assertEq(reg.owner(), owner);
        assertEq(reg.pendingOwner(), newOwner);
        assertTrue(reg.isIssuer(newOwner));
    }

    function test_Ownership_PendingOwnerCanAcceptAfterIssuerRemoved() public {
        address newOwner = makeAddr("newOwner");
        vm.startPrank(owner);
        reg.transferOwnership(newOwner);
        reg.addIssuer(newOwner);
        reg.removeIssuer(newOwner);
        vm.stopPrank();

        vm.prank(newOwner);
        reg.acceptOwnership();
        assertEq(reg.owner(), newOwner);
    }

    function test_Ownership_NonIssuerCanStillAccept() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        reg.transferOwnership(newOwner);
        assertFalse(reg.isIssuer(newOwner));

        vm.expectEmit(true, true, false, false, address(reg));
        emit OwnershipTransferred(owner, newOwner);
        vm.prank(newOwner);
        reg.acceptOwnership();
        assertEq(reg.owner(), newOwner);
        assertEq(reg.pendingOwner(), address(0));
    }

    function test_Ownership_RenounceReverts() public {
        vm.prank(owner);
        vm.expectRevert(CredentialRegistry.RenounceOwnershipDisabled.selector);
        reg.renounceOwnership();
        assertEq(reg.owner(), owner);
    }

    function test_Ownership_RenounceByNonOwnerRevertsUnauthorized() public {
        vm.prank(outsider);
        vm.expectRevert(_unauth(outsider));
        reg.renounceOwnership();
    }

    // ================= pause =================
    function test_Pause_OwnerCanPauseAndUnpauseWithEvents() public {
        vm.expectEmit(false, false, false, true, address(reg));
        emit Paused(owner);
        vm.prank(owner);
        reg.pause();
        assertTrue(reg.paused());

        vm.expectEmit(false, false, false, true, address(reg));
        emit Unpaused(owner);
        vm.prank(owner);
        reg.unpause();
        assertFalse(reg.paused());
    }

    function test_Pause_DoubleReverts() public {
        vm.startPrank(owner);
        reg.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        reg.pause();
        vm.stopPrank();
    }

    function test_Unpause_WhenNotPausedReverts() public {
        vm.prank(owner);
        vm.expectRevert(Pausable.ExpectedPause.selector);
        reg.unpause();
    }

    function test_Pause_AdminFunctionsStillWorkWhilePaused() public {
        vm.startPrank(owner);
        reg.pause();
        reg.addIssuer(issuer2);
        reg.rotateIssuer(issuer2, stranger);
        reg.removeIssuer(stranger);
        vm.stopPrank();
        assertEq(reg.issuerCount(), 1);
    }

    function test_Pause_BlocksRegistrationNotRevocation() public {
        _registerDefault();
        vm.prank(owner);
        reg.pause();

        bytes memory s = _attSig(ISSUER_PK, reg, ID2, C2, holder2, exp, dl);
        vm.prank(holder2);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        reg.registerCommitment(ID2, C2, exp, dl, issuer, s);

        vm.prank(holder);
        reg.revoke(ID1);
        assertFalse(reg.isActive(ID1));
    }

    // ================= access control: every onlyOwner function =================
    function test_AccessControl_AddIssuerNonOwner() public {
        vm.prank(outsider);
        vm.expectRevert(_unauth(outsider));
        reg.addIssuer(issuer2);
    }

    function test_AccessControl_RemoveIssuerNonOwner() public {
        vm.prank(outsider);
        vm.expectRevert(_unauth(outsider));
        reg.removeIssuer(issuer);
    }

    function test_AccessControl_RotateIssuerNonOwner() public {
        vm.prank(outsider);
        vm.expectRevert(_unauth(outsider));
        reg.rotateIssuer(issuer, issuer2);
    }

    function test_AccessControl_PauseNonOwner() public {
        vm.prank(outsider);
        vm.expectRevert(_unauth(outsider));
        reg.pause();
    }

    function test_AccessControl_UnpauseNonOwner() public {
        vm.prank(owner);
        reg.pause();
        vm.prank(outsider);
        vm.expectRevert(_unauth(outsider));
        reg.unpause();
    }

    function test_AccessControl_IssuerIsNotOwner() public {
        vm.startPrank(issuer);
        vm.expectRevert(_unauth(issuer));
        reg.addIssuer(issuer2);
        vm.expectRevert(_unauth(issuer));
        reg.removeIssuer(issuer);
        vm.expectRevert(_unauth(issuer));
        reg.rotateIssuer(issuer, issuer2);
        vm.expectRevert(_unauth(issuer));
        reg.pause();
        vm.expectRevert(_unauth(issuer));
        reg.transferOwnership(issuer);
        vm.stopPrank();
    }

    function test_AccessControl_OwnerIsNotIssuer() public {
        // owner cannot sign registrations: owner not in issuer set
        bytes memory s = _sig(ISSUER_PK, reg.attestationDigest(ID1, C1, holder, exp, dl));
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.UnauthorizedIssuer.selector);
        reg.registerCommitment(ID1, C1, exp, dl, owner, s);
    }
}
