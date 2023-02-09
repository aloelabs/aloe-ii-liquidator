# Aloe II Protocol Liquidator

Liquidates undercollateralized Aloe II Borrower accounts using UniswapV3 flash swaps as a source of capital. 

# Usage
## Setup
Before running, be sure to create a `.env` file in the `app/` directory that contains the fields specified by the `.env.template`.

## Run without Docker
You must have NodeJS and Typescript installed. Run `yarn start` from the `app/` directory.

## Run with Docker
You must have a running docker engine.
1. Build the image with `docker build -t liquidator .` from within the `app/` directory.
2. `docker run --name <CONTAINER-NAME> -i -t liquidator:latest yarn start` to run the liquidator from a docker container.
3. NOTE: to stop, simply pressing <kbd>Ctrl</kbd> + <kbd>C</kbd> will not stop the liquidator container from running! You need to run `docker stop <CONTAINER-NAME>`.

# High-level Overview
Specifies a `POLLING_INTERVAL` in `index.ts` which generates a list of all the Borrowers on the protocol every `POLLING_INTERVAL` seconds. 
1. Checks if a borrower is insolvent by estimating the gas when calling the Liquidator's `liquidate` method on the borrower. 
    1. If the gas estimate returns a value greater than 0, the borrower is deemed insolvent and is sent to the TXManager to be liquidated. 
    2. If gas estimate returns an error, the borrower is deemed solvent.
2. TXManager attempts liquidation. If it fails, retries with a gas cost that is 10% higher than the previous amount.

## Notes
# Node Provider
This implementation connects to an Alchemy node using a websocket connection. If you'd like to use a different node provider, change the following line:
```typescript
const OPTIMISM_ALCHEMY_URL = `wss://opt-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY!}`;
``` 
in the `app/index.ts` file to:

```typescript
const NODE_PROVIDER_URL = <NODE-PROVIDER-URL>;
``` 

and the following line: 
```typescript
let provider = new Web3.providers.WebsocketProvider(OPTIMISM_ALCHEMY_URL, {
    clientConfig: {
        keepalive: true,
        keepaliveInterval: 60000, // ms
    },
    reconnect: {
        auto: true,
        delay: 5000,
        maxAttempts: 5,
        onTimeout: false,
    },
});
```
to

```typescript
let provider = new Web3.providers.WebsocketProvider(NODE_PROVIDER_URL, {
    clientConfig: {
        keepalive: true,
        keepaliveInterval: 60000, // ms
    },
    reconnect: {
        auto: true,
        delay: 5000,
        maxAttempts: 5,
        onTimeout: false,
    },
});
```
Note: the change shown above assumes that the `NODE-PROVIDER-URL` begins with a `wss` because we use a `WebsocketProvider`. If you'd like to connect to your node provider using a different protocol (eg. `IPC` or `http`) you'll have to change `new Web3.providers.WebsocketProvider` to the corresponding protocol.

# Environment Variables
| Syntax      | Description |
| ----------- | ----------- |
| `WALLET_ADDRESS` | **Required**. Address which receives the liquidation reward on success. |
| `WALLET_PRIVATE_KEY` | **Required**. Used by the `TXManager` to create the `Account` object that sends and signs liquidation transactions. |
| `ALCHEMY_API_KEY` | Used to initialize the `Web3` client that gets information from the blockchain and sends transactions.|
| `FACTORY_ADDRESS` | **Required**. Address of the Aloe II Factory that is responsible for creating borrowers.|
| `CREATE_ACCOUNT_TOPIC_ID` | **Required**. Specifies the topic that provides the address of the newly created borrower. |
| `LIQUIDATOR_ADDRESS` | **Required**. Address of the liquidator contract on-chain. See `app/addresses.md` for details. |
| `SLACK_WEBHOOK0`, `SLACK_WEBHOOK1`, `SLACK_WEBHOOK2` | *OPTIONAL* Webhooks setup to receive logs from the liquidator |