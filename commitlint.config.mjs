// Contrôle du format des messages de commit (Conventional Commits).
// Format : type(portée): description en français
// Exemple : feat(api): ajoute le point de santé /health
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
    'scope-enum': [
      1,
      'always',
      ['api', 'web-public', 'web-admin', 'shared', 'db', 'ci', 'deps', 'docs', 'socle'],
    ],
    // Une description en français commence souvent par une minuscule ou un accent : on ne force pas la casse.
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
  },
};
