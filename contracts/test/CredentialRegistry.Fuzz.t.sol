// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CredentialRegistry} from "../CredentialRegistry.sol";
import {CredentialRegistryTestBase} from "./CredentialRegistry.Base.t.sol";

contract CredentialRegistryFuzzTest is CredentialRegistryTestBase {
    function testFuzz_ExpiryBounds(uint64 e) public {
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, e, dl);
        bool valid = e > T0 && e <= T0 + 730 days;
        vm.prank(holder);
        if (!valid) vm.expectRevert(CredentialRegistry.InvalidExpiration.selector);
        reg.registerCommitment(ID1, C1, e, dl, issuer, s);
        if (valid) {
            assertEq(reg.getCredential(ID1).expiresAt, e);
            assertTrue(reg.isActive(ID1));
        } else {
            assertEq(uint8(reg.statusOf(ID1)), uint8(CredentialRegistry.Status.None));
        }
    }

    function testFuzz_DeadlineBounds(uint64 d) public {
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, exp, d);
        vm.prank(holder);
        if (d < T0) {
            vm.expectRevert(CredentialRegistry.DeadlineExpired.selector);
        } else if (d > T0 + 7 days) {
            vm.expectRevert(CredentialRegistry.DeadlineTooFar.selector);
        }
        reg.registerCommitment(ID1, C1, exp, d, issuer, s);
        if (d >= T0 && d <= T0 + 7 days) assertTrue(reg.isActive(ID1));
    }

    function testFuzz_RevocationDeadlineBounds(uint64 d) public {
        _registerDefault();
        bytes memory s = _revSig(ISSUER_PK, ID1, d);
        if (d < T0) {
            vm.expectRevert(CredentialRegistry.DeadlineExpired.selector);
        } else if (d > T0 + 7 days) {
            vm.expectRevert(CredentialRegistry.DeadlineTooFar.selector);
        }
        reg.revokeWithSignature(ID1, d, issuer, s);
        if (d >= T0 && d <= T0 + 7 days) {
            assertEq(uint8(reg.statusOf(ID1)), uint8(CredentialRegistry.Status.Revoked));
        }
    }

    function testFuzz_StatusOverTime(uint256 lifetime, uint256 elapsed, bool revokeFirst) public {
        lifetime = bound(lifetime, 1, 730 days);
        elapsed = bound(elapsed, 0, 1500 days);
        uint64 e = uint64(T0 + lifetime);
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, e, dl);
        vm.prank(holder);
        reg.registerCommitment(ID1, C1, e, dl, issuer, s);

        if (revokeFirst) {
            vm.prank(holder);
            reg.revoke(ID1);
        }
        vm.warp(T0 + elapsed);

        CredentialRegistry.Status st = reg.statusOf(ID1);
        if (revokeFirst) {
            assertEq(uint8(st), uint8(CredentialRegistry.Status.Revoked));
        } else if (elapsed < lifetime) {
            assertEq(uint8(st), uint8(CredentialRegistry.Status.Active));
        } else {
            assertEq(uint8(st), uint8(CredentialRegistry.Status.Expired));
        }
        assertEq(reg.isActive(ID1), st == CredentialRegistry.Status.Active);
    }

    function testFuzz_SignatureBoundToHolder(address other) public {
        vm.assume(other != holder && other != address(0));
        bytes memory s = _defaultSig();
        vm.prank(other);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
    }

    function testFuzz_SignatureBoundToChain(uint64 newChain) public {
        vm.assume(newChain != block.chainid && newChain != 0);
        bytes memory s = _defaultSig();
        vm.chainId(newChain);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.InvalidSignature.selector);
        reg.registerCommitment(ID1, C1, exp, dl, issuer, s);
    }

    function testFuzz_RegisterAtArbitraryStartTime(uint32 startOffset, uint32 life) public {
        uint256 start = T0 + uint256(startOffset);
        vm.warp(start);
        uint256 lifetime = bound(life, 1, 730 days);
        uint64 e = uint64(start + lifetime);
        uint64 d = uint64(start + 1 days);
        bytes memory s = _attSig(ISSUER_PK, reg, ID1, C1, holder, e, d);
        vm.prank(holder);
        reg.registerCommitment(ID1, C1, e, d, issuer, s);
        assertEq(reg.getCredential(ID1).registeredAt, uint64(start));
        assertTrue(reg.isActive(ID1));
    }

    function testFuzz_UniqueIdsAndCommitments(bytes32 id, bytes32 commitment) public {
        vm.assume(id != bytes32(0) && commitment != bytes32(0));
        _register(id, commitment, holder);
        assertEq(reg.commitmentToCredentialId(commitment), id);
        // reusing either side always reverts
        bytes32 otherId = keccak256(abi.encode(id, "x"));
        bytes32 otherC = keccak256(abi.encode(commitment, "y"));
        bytes memory s1 = _attSig(ISSUER_PK, reg, id, otherC, holder, exp, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.CredentialIdAlreadyUsed.selector);
        reg.registerCommitment(id, otherC, exp, dl, issuer, s1);
        bytes memory s2 = _attSig(ISSUER_PK, reg, otherId, commitment, holder, exp, dl);
        vm.prank(holder);
        vm.expectRevert(CredentialRegistry.CommitmentAlreadyUsed.selector);
        reg.registerCommitment(otherId, commitment, exp, dl, issuer, s2);
    }
}

/// @dev Drives random owner-side issuer management over a small address pool.
contract IssuerHandler is Test {
    CredentialRegistry public reg;
    address public owner;
    address[] public pool;

    constructor(CredentialRegistry _reg, address _owner, address[] memory _pool) {
        reg = _reg;
        owner = _owner;
        pool = _pool;
    }

    function poolLength() external view returns (uint256) {
        return pool.length;
    }

    function add(uint256 i) external {
        i = bound(i, 0, pool.length - 1);
        vm.prank(owner);
        try reg.addIssuer(pool[i]) {} catch {}
    }

    function remove(uint256 i) external {
        i = bound(i, 0, pool.length - 1);
        vm.prank(owner);
        try reg.removeIssuer(pool[i]) {} catch {}
    }

    function rotate(uint256 i, uint256 j) external {
        i = bound(i, 0, pool.length - 1);
        j = bound(j, 0, pool.length - 1);
        vm.prank(owner);
        try reg.rotateIssuer(pool[i], pool[j]) {} catch {}
    }
}

contract CredentialRegistryInvariantTest is CredentialRegistryTestBase {
    IssuerHandler internal handler;
    address[] internal pool;

    function setUp() public override {
        super.setUp();
        pool.push(issuer); // initial issuer is part of the tracked pool
        for (uint256 i = 0; i < 5; i++) {
            pool.push(makeAddr(string(abi.encodePacked("pool", vm.toString(i)))));
        }
        handler = new IssuerHandler(reg, owner, pool);
        targetContract(address(handler));
    }

    /// issuerCount never falls below one.
    function invariant_AtLeastOneIssuer() public view {
        assertGe(reg.issuerCount(), 1);
    }

    /// issuerCount always equals the number of addresses flagged isIssuer.
    function invariant_IssuerCountMatchesFlags() public view {
        uint256 n;
        for (uint256 i = 0; i < pool.length; i++) {
            if (reg.isIssuer(pool[i])) n++;
        }
        assertEq(reg.issuerCount(), n);
    }
}
