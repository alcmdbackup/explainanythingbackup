// Tests for branch-type detection regex from /initialize Step 1.
describe('branch type detection regex', () => {
  function detectBranchType(projectName: string): string {
    if (/^fix_/.test(projectName)) return 'fix';
    if (/^hotfix_/.test(projectName)) return 'hotfix';
    if (/^chore_/.test(projectName)) return 'chore';
    if (/^docs_/.test(projectName)) return 'docs';
    return 'feat';
  }

  const cases: [string, string][] = [
    ['feat_foo_20260501', 'feat'],
    ['fix_bug_20260501', 'fix'],
    ['hotfix_auth_20260501', 'hotfix'],
    ['chore_cleanup_20260501', 'chore'],
    ['docs_update_20260501', 'docs'],
    ['my_feature_20260501', 'feat'],   // no prefix → default feat
    ['fixup_typo_20260501', 'feat'],   // "fixup" doesn't match "^fix_"
    ['fixture_test_20260501', 'feat'], // "fixture" doesn't match "^fix_"
    ['documentary_20260501', 'feat'],  // "documentary" doesn't match "^docs_"
    ['fix_', 'fix'],                    // bare prefix
    ['fix_;rm -rf_20260501', 'fix'],   // injection-like name — regex extracts prefix only
    ['CHORE_upper_20260501', 'feat'],  // uppercase doesn't match (case-sensitive)
  ];

  test.each(cases)('"%s" → %s', (name, expected) => {
    expect(detectBranchType(name)).toBe(expected);
  });
});
