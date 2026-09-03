/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['<rootDir>/packages/**/*.spec.ts', '<rootDir>/apps/**/*.spec.ts', '<rootDir>/scripts/**/*.spec.ts'],
  testPathIgnorePatterns: ['<rootDir>/(packages|apps)/.*dist/.*', '<rootDir>/node_modules/'],
  moduleNameMapper: {
    '^@projectx/domain$': '<rootDir>/packages/domain/src',
    '^@projectx/infrastructure$': '<rootDir>/packages/infrastructure/src',
    '^@projectx/ai-runtime$': '<rootDir>/packages/ai-runtime/src',
    '^@projectx/application$': '<rootDir>/packages/application/src',
    '^@projectx/shared$': '<rootDir>/packages/shared/src',
    '^@projectx/intelligence$': '<rootDir>/packages/intelligence/src',
    '^@projectx/mission-orchestrator$': '<rootDir>/packages/mission-orchestrator/src',
    '^@projectx/outreach$': '<rootDir>/packages/outreach/src',
    '^@projectx/conversation$': '<rootDir>/packages/conversation/src',
    '^@projectx/control-plane$': '<rootDir>/packages/control-plane/src',
    '^@projectx/temporal-client$': '<rootDir>/packages/temporal-client/src',
    '^@projectx/tool-gateway$': '<rootDir>/packages/tool-gateway/src',
    '^@projectx/llm-gateway$': '<rootDir>/packages/llm-gateway/src',
    '^@projectx/specialist-agents$': '<rootDir>/packages/specialist-agents/src',
  },
  transform: {
    '^.+\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        cache: false,
        diagnostics: {
          ignoreCodes: [5103],
        },
      },
    ],
  },
  collectCoverageFrom: ['<rootDir>/(packages|apps)/*/src/**/*.ts', '!<rootDir>/**/*.spec.ts'],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
  restoreMocks: true,
};
