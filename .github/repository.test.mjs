// Test the git commit history and repository structure
// node --test --experimental-test-snapshots --test-update-snapshots

// https://nodejs.org/docs/latest-v22.x/api/test.html
import { describe, it } from "node:test";

// https://nodejs.org/docs/latest-v22.x/api/assert.html
import assert from "node:assert/strict";

// https://nodejs.org/docs/latest-v22.x/api/child_process.html#child_processexecsynccommand-options
import { execSync } from "node:child_process";

function runCommand(command) {
  //console.log(`Running command "${command}"`);
  try {
    return execSync(command, { encoding: "utf-8" }).trim();
  } catch (error) {
    if (error.stdout) return error.stdout.trim();
    throw new Error(`Command failed: ${error.message}`);
  }
}

// https://git-scm.com/docs/git-log#_pretty_formats
function getCommitHistory() {
  const logFormat = "%H|%an|%cn|%ad|%B----END----";
  const output = runCommand(
    `git log --pretty=format:"${logFormat}" --date=iso8601-strict`
  );
  return output
    .split("----END----")
    .filter(Boolean)
    .map((entry) => {
      const [hash, author, committer, authorDate, message] = entry
        .split("|")
        .map((str) => str.trim());
      return { hash, author, committer, authorDate, message };
    });
}

function getFilesForCommit(hash) {
  const output = runCommand(`git show --pretty="" --name-only ${hash}`);
  return output.split("\n").filter(Boolean);
}

function scanSecrets() {
  const command = "./gitleaks git --verbose --no-banner --report-format json";
  const output = runCommand(command);
  return output ? JSON.parse(output) : [];
}

function parseDate(dateString) {
  return new Date(dateString);
}

const commits = getCommitHistory();

describe("only one branch", () => {
  it("should have only one branch", () => {
    const branches = runCommand("git branch --list")
      .split("\n")
      .filter(Boolean);
    assert.strictEqual(
      branches.length,
      1,
      "Expected only one branch in the repository"
    );
  });

  it("should ensure the 1st commit has GPG signing", () => {
    const firstCommit = commits[commits.length - 1]?.hash;
    assert.ok(firstCommit, "1st commit not found");
    const signature = runCommand(
      `git log --show-signature -n 1 ${firstCommit}`
    );
    assert.ok(signature, "1st commit signature not found");
    assert.match(
      signature,
      /gpg: Signature made/,
      "1st commit is not GPG signed"
    );
  });
});

describe("commit messages", () => {
  it("should verify commit messages follow the expected format", () => {
    commits.forEach((commit) => {
      assert.ok(commit.message, "Commit message is empty");
      assert.match(
        commit.message,
        /^[A-Z].+/,
        "Commit message did not start with a capital letter"
      );
    });
  });

  it("should have commit messages in the expected order", (test) => {
    const commitMessages = commits.map((commit) => commit.message);
    test.assert.snapshot(commitMessages);
  });
});

describe("files touched in commits", () => {
  it("should only touch LICENSE when it was added", () => {
    const targetCommit = commits.find((commit) =>
      commit.message.startsWith("License as CC")
    );
    assert.ok(targetCommit, "Could not find license commit");
    const files = getFilesForCommit(targetCommit.hash);
    assert.deepStrictEqual(files, ["LICENSE"]);
  });

  it("should only touch package.json when dependencies were updated", () => {
    const targetCommit = commits.find((commit) =>
      commit.message.startsWith("Update Node.js dependencies")
    );
    assert.ok(targetCommit, "Could not find update commit");
    const files = getFilesForCommit(targetCommit.hash);
    assert.deepStrictEqual(files, ["package.json"]);
  });
});

describe("tags and sign-off", () => {
  it("should have no tags", () => {
    const tags = runCommand(`git tag`).split("\n").filter(Boolean);
    assert.equal(tags.length, 0, "There should be no tags in the repository");
  });

  it("should have two commits with sign-off", () => {
    const signOffs = commits.filter((commit) =>
      /Signed-off-by:/.test(commit.message)
    );
    assert.equal(
      signOffs.length,
      2,
      "There should be two commits with sign-off"
    );
  });
});

describe("commit author dates", () => {
  const commits = getCommitHistory();

  it("should have valid commit and author dates", () => {
    commits.forEach((commit) => {
      const authorDate = parseDate(commit.authorDate);
      assert.ok(
        !isNaN(authorDate),
        `Invalid author date: ${commit.authorDate}`
      );
    });
  });

  it("should have author dates in the expected chronogical order", (test) => {
    const authorDates = commits.map((commit) => commit.authorDate);
    test.assert.snapshot(authorDates);
  });
});

describe("content and validity", () => {
  it("should have valid package.json scripts", () => {
    const expected = {
      dev: "vite",
      build: "tsc -b && vite build",
      lint: "eslint .",
      preview: "vite preview",
    };
    // https://docs.npmjs.com/cli/v11/commands/npm-pkg
    const body = runCommand(`npm pkg get scripts --json`);
    const json = JSON.parse(body);
    assert.deepStrictEqual(json, expected);
  });

  it("should have a valid .gitignore file", () => {
    const body = runCommand("cat .gitignore");
    assert.match(body, /node_modules/);
    assert.match(body, /dist/);
  });

  it("should have a valid LICENSE file", () => {
    const body = runCommand("cat LICENSE");
    assert.match(body, /^Attribution-ShareAlike 4\.0 International/);
    assert.match(
      body,
      /Creative Commons may be contacted at creativecommons\.org\./
    );
  });

  it("should not find any secrets in the repository", () => {
    const leaks = scanSecrets();
    assert.strictEqual(leaks.length, 0, "Secrets detected in the repository");
  });
});
