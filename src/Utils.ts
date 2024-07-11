import axios from 'axios';

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timed out in ${ms} ms.`));
      }, ms);
    }),
  ]);
}

export function getLogsBaseScan(
  fromBlock: number,
  address: string,
  topics: (string | null)[],
  shouldMatchAll: boolean,
  pageLength = 1000,
  page?: number,
  toBlock?: number
) {
  let query = `https://api.basescan.org/api?module=logs&action=getLogs`.concat(
    `&fromBlock=${fromBlock.toFixed(0)}`,
    toBlock ? `&toBlock=${toBlock.toFixed(0)}` : '&toBlock=latest',
    `&address=${address}`
  );

  for (let i = 0; i < topics.length; i += 1) {
    if (topics[i] === null) continue;
    query += `&topic${i}=${topics[i]}`;

    if (i === topics.length - 1) break;
    query += `&topic${i}_${i + 1}_opr=${shouldMatchAll ? 'and' : 'or'}`;
  }

  if (page) query += `&page=${page}`;
  query += `&offset=${pageLength}`;
  if (process.env.BASESCAN_API_KEY) query += `&apikey=${process.env.BASESCAN_API_KEY}`;

  return axios.get(query);
}
