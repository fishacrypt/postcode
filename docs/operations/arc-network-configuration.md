# Arc network configuration

Nothing in this repository is deployed to, or sends a transaction on, any network. This page records the values the app is prepared to use.

## Verified values

Checked on 17 November 2026 against the official page https://docs.arc.io/arc/references/connect-to-arc.md and against the chain registry Arc Studio generates into `src/onchain-facts.ts` (the app imports chain data from there, never from literals).

| | Arc Testnet | Arc Mainnet |
| --- | --- | --- |
| Chain ID | 5042002 | 5042 |
| RPC | https://rpc.testnet.arc.io | https://rpc.mainnet.arc.io |
| Explorer | https://explorer.testnet.arc.io | https://explorer.arc.io |
| Native currency | USDC | USDC |

Re-check these before every deployment. Docs and registries change.

## Decimals: native gas versus ERC-20 USDC

On Arc, USDC is both the gas token and an ERC-20. The same pool of money is exposed two ways:

- Native view (gas, `msg.value`, `eth_getBalance`): **18 decimals**.
- ERC-20 view (`balanceOf`, `transfer`, approvals, anything you display): **6 decimals**.

PostcodeProof moves no money. The registry has no payable function, no `receive` or fallback, and holds no tokens, so the two conventions never meet in this contract. The only place gas appears is the holder paying the transaction fee for `registerCommitment` from their wallet. If you later add fees in USDC, convert only with `usdcToGasToken` and `gasTokenToUsdc` from `src/onchain-money.ts`, never with a hand-written rescale, and show one USDC balance rather than adding both views.

Other Arc differences from the official EVM-differences page that matter here: Arc targets the Osaka baseline; the mempool enforces a 20 Gwei `maxFeePerGas` floor; sends to `address(0)` revert. The Foundry profile compiles for the `cancun` EVM, which the contract supports. Before any real deployment, build and test with Arc Foundry (`arc-forge`) and run the suite there as well.

## What the app does with a chain

- `ANCHOR_CHAIN_ID` selects the chain the API signs attestations for (default 5042002).
- `VITE_REGISTRY_ADDRESS` is the address of a registry **you** deploy. While it is empty, anchoring returns `registry_not_configured` and the UI says anchoring is not enabled.
- Reads and receipt checks use the Arc Studio RPC proxy when present (`RPC_PROXY_*`) and otherwise the public RPC from the chain registry. Public RPC may rate-limit.

## Deployment roles (when you are ready)

1. Deployer: a new throwaway wallet funded only for gas. Never a wallet used elsewhere.
2. Owner: a multisig. Pass it as `initialOwner`.
3. Issuer: the signing service address. Pass it as `initialIssuer`. It must differ from the owner.
4. Holders: ordinary wallets that submit their own `registerCommitment` calls.

Do not request, paste or store production private keys in this repository, in chat, or in `VITE_` variables.
