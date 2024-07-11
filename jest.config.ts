// /** @type {import('ts-jest').JestConfigWithTsJest} */
// module.exports = {
//   preset: 'ts-jest',
//   testEnvironment: 'node --experimental-vm-modules',
//   transform: {},
// };
import type {Config} from 'jest';

const config: Config = {
  preset: "ts-jest",
  testEnvironment: 'node',
  setupFilesAfterEnv: ["./console_override.js"],
};

export default config;
