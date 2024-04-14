import { fork } from 'child_process';
import { arbitrum, base, mainnet, optimism } from 'viem/chains';

const chains = [mainnet.id, optimism.id, arbitrum.id, base.id];

chains.forEach((chain) => {
    const other = fork('lib/example.js', ['--chain', chain.toFixed(0)], {});
    other.on('spawn', () => console.log(`Forked process for chain ${chain}`));

    // TODO: handle errors and exits
});
