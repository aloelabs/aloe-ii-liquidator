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
1. Checks if a borrower is insolvent by estimating the gas when calling `warn()` on the borrower. 
    1. If the gas estimate returns a value greater than 0, the borrower is deemed insolvent and is sent to the TXManager to be liquidated. 
    2. If gas estimate for `warn()` returns an error, the borrower is deemed solvent.
2. TXManager attempts liquidation. If it fails, retries with a gas cost that is 10% higher than the previous amount.