/** @type {import('ts-jest').JestConfigWithTsJest} */
const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: ['<rootDir>/tests/e2e/phase14/**/*.spec.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/e2e/phase14/setup.ts'],
  testTimeout: 120_000,
};
