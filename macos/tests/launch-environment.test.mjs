import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertSameProfile, parseProcessEnvironment, validateLaunchEnvironment } from "../scripts/launch-environment-macos.mjs";

async function snapshot(root, prefix = "") {
  const entries = [];
  for (const entry of (await readdir(path.join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      entries.push([relative, "directory"], ...await snapshot(root, relative));
    } else if (entry.isFile()) {
      entries.push([relative, (await readFile(path.join(root, relative))).toString("base64")]);
    } else {
      entries.push([relative, "symlink"]);
    }
  }
  return entries;
}

const temporary = await mkdtemp(path.join(os.tmpdir(), "dreamskin-launch-environment-"));
try {
  const root = await realpath(temporary);
  const home = path.join(root, "Account Home");
  const defaultProfile = path.join(home, ".codex");
  const customProfile = path.join(root, "Custom Profile");
  const otherHome = path.join(root, "Other Home");
  const homeAlias = path.join(root, "home-alias");
  const profileAlias = path.join(root, "profile-alias");
  for (const directory of [defaultProfile, customProfile, otherHome,
    path.join(defaultProfile, "sessions"), path.join(home, "projects", "sample"),
    path.join(home, "Library", "Application Support", "CodexDreamSkinStudio", "theme")]) {
    await mkdir(directory, { recursive: true });
  }
  const sentinels = new Map([
    [path.join(defaultProfile, "config.toml"), 'model = "fixture-model"\n'],
    [path.join(defaultProfile, "sessions", "chat.jsonl"), '{"message":"fixture chat must survive"}\n'],
    [path.join(home, "projects", "sample", "source.txt"), "fixture project must survive\n"],
    [path.join(home, "Library", "Application Support", "CodexDreamSkinStudio", "state.json"), '{"session":"fixture"}\n'],
    [path.join(home, "Library", "Application Support", "CodexDreamSkinStudio", "theme", "theme.json"), '{"id":"fixture-theme"}\n'],
    [path.join(customProfile, "config.toml"), 'model = "custom-fixture-model"\n'],
    [path.join(otherHome, "sentinel"), "isolated home must survive\n"],
  ]);
  for (const [file, content] of sentinels) await writeFile(file, content);
  await symlink(home, homeAlias, "dir");
  await symlink(customProfile, profileAlias, "dir");
  const before = await snapshot(root);

  for (const environment of [{ HOME: home }, { HOME: home, CFFIXED_USER_HOME: home }]) {
    assert.deepEqual(await validateLaunchEnvironment(Object.freeze(environment), home), {
      home, codexHome: defaultProfile,
    }, "A normal account environment must retain its existing default profile.");
  }
  const customEnvironment = Object.freeze({ HOME: home, CODEX_HOME: customProfile });
  const custom = await validateLaunchEnvironment(customEnvironment, home);
  assert.deepEqual(custom, {
    home, codexHome: customProfile,
  }, "An existing custom CODEX_HOME must not be reset to the default profile.");
  assert.deepEqual(customEnvironment, { HOME: home, CODEX_HOME: customProfile });
  assert.deepEqual(await validateLaunchEnvironment({ HOME: homeAlias, CFFIXED_USER_HOME: home, CODEX_HOME: profileAlias }, home), {
    home, codexHome: customProfile,
  }, "Directory aliases must be compared by their canonical paths.");

  const invalidEnvironments = [
    ["absent HOME", {}],
    ["preview mode", { HOME: home, DREAMSKIN_PREVIEW: "1" }],
    ["different HOME", { HOME: otherHome }],
    ["different CFFIXED_USER_HOME", { HOME: home, CFFIXED_USER_HOME: otherHome }],
    ["relative HOME", { HOME: "relative-home" }],
    ["missing HOME", { HOME: path.join(root, "missing-home") }],
    ["file as HOME", { HOME: path.join(defaultProfile, "config.toml") }],
    ["relative CFFIXED_USER_HOME", { HOME: home, CFFIXED_USER_HOME: "relative-home" }],
    ["missing CFFIXED_USER_HOME", { HOME: home, CFFIXED_USER_HOME: path.join(root, "missing-fixed-home") }],
    ["relative CODEX_HOME", { HOME: home, CODEX_HOME: "relative-profile" }],
    ["missing CODEX_HOME", { HOME: home, CODEX_HOME: path.join(root, "missing-profile") }],
    ["file as CODEX_HOME", { HOME: home, CODEX_HOME: path.join(defaultProfile, "config.toml") }],
  ];
  for (const [label, environment] of invalidEnvironments) {
    await assert.rejects(() => validateLaunchEnvironment(Object.freeze(environment), home), undefined,
      `${label} must be rejected rather than redirected to another profile.`);
    assert.deepEqual(await snapshot(root), before, `${label} changed fixture data or created state before rejection.`);
  }

  const ordinary = await validateLaunchEnvironment({ HOME: home }, home);
  await assertSameProfile(ordinary, { HOME: home });
  await assertSameProfile(custom, { HOME: home, CODEX_HOME: customProfile });
  await assertSameProfile(custom, { HOME: homeAlias, CODEX_HOME: profileAlias });
  await assert.rejects(() => assertSameProfile(ordinary, { HOME: home, CODEX_HOME: customProfile }),
    undefined, "A running custom profile must not be adopted as the default profile.");
  await assert.rejects(() => assertSameProfile(custom, { HOME: home }),
    undefined, "A custom manager profile must not silently reuse the default profile.");
  await assert.rejects(() => assertSameProfile(custom, { CODEX_HOME: customProfile }),
    undefined, "A process without an inspectable HOME must not be adopted.");
  for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) {
    const value = path.join(root, key);
    await assertSameProfile(ordinary, { HOME: home, [key]: value }, { HOME: home, [key]: value });
    for (const observed of [{ HOME: home }, { HOME: home, [key]: `${value}-other` }]) {
      await assert.rejects(() => assertSameProfile(ordinary, observed, { HOME: home, [key]: value }),
        undefined, `${key} changes must block reuse or restart of the running profile.`);
    }
    await assert.rejects(() => assertSameProfile(ordinary, { HOME: home, [key]: value }, { HOME: home }),
      undefined, `An unexpected running ${key} must not be cleared silently.`);
  }

  const processEnvironment = {
    HOME: home,
    CFFIXED_USER_HOME: home,
    CODEX_HOME: customProfile,
    XDG_CONFIG_HOME: path.join(root, "Config Home"),
    XDG_DATA_HOME: path.join(root, "Data Home"),
    XDG_STATE_HOME: path.join(root, "State Home"),
    XDG_CACHE_HOME: path.join(root, "Cache Home"),
  };
  const processText = `/fixture/ChatGPT --remote-debugging-port=9341 PATH=/fixture/bin ${
    Object.entries(processEnvironment).map(([key, value]) => `${key}=${value}`).join(" ")
  } UNRELATED_TOKEN=fixture-secret LANG=en_US.UTF-8`;
  assert.deepEqual(parseProcessEnvironment(processText), processEnvironment,
    "Process environment parsing must retain profile paths with spaces and exclude unrelated values.");
  assert.throws(() => parseProcessEnvironment("/fixture/ChatGPT PATH=/fixture/bin UNRELATED_TOKEN=fixture-secret"),
    "An uninspectable process environment must not be treated as the default profile.");
  assert.throws(() => parseProcessEnvironment(""));
  assert.throws(() => parseProcessEnvironment(`HOME=${home} CODEX_HOME=${customProfile} HOME=${otherHome}`),
    "Duplicate profile assignments must be rejected instead of choosing an ambiguous value.");
  assert.deepEqual(await snapshot(root), before, "Validation must not modify account, project, chat, theme or profile data.");

  if (process.platform === "darwin") {
    const scripts = path.join(root, "engine", "scripts");
    const application = path.join(root, "application");
    const fakeApp = path.join(root, "FakeChatGPT.app");
    const fixtureDirectories = [scripts, path.join(application, "runtime", "node"),
      path.join(application, "shared", "core"), path.join(fakeApp, "Contents", "MacOS")];
    for (const directory of fixtureDirectories) await mkdir(directory, { recursive: true });
    const dscl = path.join(root, "dscl-mock.sh");
    await writeFile(dscl, '#!/bin/bash\n/usr/bin/printf "NFSHomeDirectory: %s\\n" "$FIXTURE_ACCOUNT_HOME"\n', { mode: 0o700 });
    const sourceDirectory = new URL("../scripts/", import.meta.url);
    const commonSource = await readFile(new URL("common-macos.sh", sourceDirectory), "utf8");
    assert.ok(commonSource.includes("/usr/bin/dscl"), "The account-home command must be intercepted in the fixture.");
    await writeFile(path.join(scripts, "common-macos.sh"), commonSource.replaceAll("/usr/bin/dscl", `"${dscl}"`));
    const entryNames = ["start-dream-skin-macos.sh", "restore-dream-skin-macos.sh", "switch-theme-macos.sh",
      "pause-dream-skin-macos.sh", "install-dream-skin-macos.sh", "apply-community-theme-macos.sh",
      "manager-community.sh", "manager-maintenance.sh", "manager-platform.sh"];
    for (const name of ["localization-macos.sh", "process-identity-macos.sh", "theme-switch-lock-macos.sh", ...entryNames]) {
      await writeFile(path.join(scripts, name), await readFile(new URL(name, sourceDirectory)));
    }
    // Even if an entry guard regresses, app discovery selects this unsigned
    // fixture and cannot reach the user's installed application or its data.
    await writeFile(path.join(fakeApp, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.openai.codex</string>
<key>CFBundleExecutable</key><string>ChatGPT</string>
<key>CFBundleShortVersionString</key><string>99.0.0</string>
</dict></plist>\n`);
    const forbiddenExecutable = '#!/bin/bash\n/usr/bin/printf "Unexpected executable invocation\\n" > "$FIXTURE_EXECUTION_MARKER"\nexit 99\n';
    await writeFile(path.join(fakeApp, "Contents", "MacOS", "ChatGPT"), forbiddenExecutable, { mode: 0o700 });
    await writeFile(path.join(application, "runtime", "node", "node"), forbiddenExecutable, { mode: 0o700 });
    await writeFile(path.join(application, "shared", "core", "apply-worker.mjs"), "throw new Error('Fixture worker must not execute');\n");
    const request = path.join(root, "request.json");
    await writeFile(request, "{}\n");
    const entries = [
      ["start-dream-skin-macos.sh", ["--restart-existing"]],
      ["restore-dream-skin-macos.sh", ["--restart-codex"]],
      ["switch-theme-macos.sh", ["--id", "fixture-theme"]],
      ["pause-dream-skin-macos.sh", []],
      ["install-dream-skin-macos.sh", ["--no-launch"]],
      ["apply-community-theme-macos.sh", ["--id", "fixture-theme"]],
      ["manager-community.sh", [application, request]],
      ["manager-maintenance.sh", ["execute", application, request]],
      ...["apply", "pause", "restore", "commitcommunity"].map(action => ["manager-platform.sh", [action, application, request]]),
    ];
    const environment = { HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", DREAMSKIN_LANG: "en-US",
      CODEX_APP_BUNDLE: fakeApp, FIXTURE_ACCOUNT_HOME: home, FIXTURE_EXECUTION_MARKER: path.join(root, "unexpected-execution") };
    const entryBaseline = await snapshot(root);
    for (const profile of [undefined, customProfile]) {
      const result = spawnSync("/bin/bash", ["-c",
        '. "$1"; assert_codex_user_environment; printf "%s\\n%s\\n" "${CODEX_HOME-<unset>}" "$CONFIG_PATH"',
        "fixture", path.join(scripts, "common-macos.sh")], {
        cwd: root, env: { ...environment, ...(profile === undefined ? {} : { CODEX_HOME: profile }) },
        encoding: "utf8", timeout: 5000,
      });
      assert.equal(result.status, 0, `The real guard must accept a valid fixture account: ${result.stderr}`);
      assert.equal(result.stdout, `${profile ?? "<unset>"}\n${path.join(profile ?? defaultProfile, "config.toml")}\n`,
        "The real shell guard must not reset CODEX_HOME or select another config.toml.");
      assert.deepEqual(await snapshot(root), entryBaseline, "The valid shell guard must not write state.");
    }
    for (const contamination of [{ HOME: otherHome }, { CFFIXED_USER_HOME: otherHome }, { DREAMSKIN_PREVIEW: "1" }]) {
      for (const [name, args] of entries) {
        const label = `${name} ${args[0] ?? ""} with ${Object.keys(contamination)[0]}`;
        const result = spawnSync("/bin/bash", [path.join(scripts, name), ...args], {
          cwd: root, env: { ...environment, ...contamination }, encoding: "utf8", timeout: 5000,
        });
        assert.equal(result.error, undefined, `${label}: ${result.error?.message}`);
        assert.equal(result.signal, null, `${label} must reject normally rather than time out.`);
        assert.notEqual(result.status, 0, `${label} unexpectedly passed its environment guard.`);
        assert.match(result.stderr, /DREAM_SKIN_ENVIRONMENT_MISMATCH:/,
          `${label} failed for an unrelated reason: ${result.stdout}\n${result.stderr}`);
        assert.deepEqual(await snapshot(root), entryBaseline, `${label} wrote state or changed fixture data before rejecting.`);
      }
    }
    console.log(`PASS: ${entries.length * 3} real shell entry-point cases reject contamination before any fixture writes.`);

    const launchScripts = path.join(root, "launch-engine", "scripts");
    const operatingSystemTemp = path.join(root, "OS Temporary Directory");
    await mkdir(launchScripts, { recursive: true });
    await mkdir(operatingSystemTemp);
    const recorder = path.join(root, "record-launch.mjs");
    const launchLog = path.join(root, "launch-calls.jsonl");
    await writeFile(recorder, `import { appendFileSync } from "node:fs";
const environment = Object.fromEntries(["HOME", "CODEX_HOME", "CFFIXED_USER_HOME", "TMPDIR"].map(key => [key, process.env[key] ?? null]));
appendFileSync(process.env.FIXTURE_LAUNCH_LOG, JSON.stringify({ command: process.argv[2], argv: process.argv.slice(3), environment }) + "\\n");
`);
    const commandMocks = new Map([["/usr/bin/dscl", dscl]]);
    for (const name of ["open", "nohup"]) {
      const mock = path.join(root, `${name}-mock.sh`);
      await writeFile(mock, `#!/bin/bash\nexec "$FIXTURE_NODE" "$FIXTURE_RECORDER" ${name} "$@"\n`, { mode: 0o700 });
      commandMocks.set(`/usr/bin/${name}`, mock);
    }
    const launchctl = path.join(root, "launchctl-mock.sh");
    await writeFile(launchctl, "#!/bin/bash\nexit 0\n", { mode: 0o700 });
    commandMocks.set("/bin/launchctl", launchctl);
    const getconf = path.join(root, "getconf-mock.sh");
    await writeFile(getconf, '#!/bin/bash\n[ "$1" = DARWIN_USER_TEMP_DIR ] || exit 99\n/usr/bin/printf "%s\\n" "$FIXTURE_OS_TEMP"\n', { mode: 0o700 });
    commandMocks.set("/usr/bin/getconf", getconf);
    let launchCommon = commonSource;
    for (const [command, mock] of commandMocks) {
      assert.ok(launchCommon.includes(command), `The real ${command} boundary must be intercepted.`);
      launchCommon = launchCommon.replaceAll(command, `"${mock}"`);
    }
    await writeFile(path.join(launchScripts, "common-macos.sh"), launchCommon);
    await writeFile(path.join(launchScripts, "localization-macos.sh"), await readFile(new URL("localization-macos.sh", sourceDirectory)));
    await writeFile(path.join(launchScripts, "process-identity-macos.sh"), await readFile(new URL("process-identity-macos.sh", sourceDirectory)));
    const helperSource = await readFile(new URL("launch-environment-macos.mjs", sourceDirectory), "utf8");
    assert.equal(helperSource.split("os.userInfo().homedir").length, 2,
      "Only the account identity lookup may be substituted in the real helper.");
    await writeFile(path.join(launchScripts, "launch-environment-macos.mjs"),
      helperSource.replace("os.userInfo().homedir", JSON.stringify(home)));
    const stateDirectory = path.join(home, "Library", "Application Support", "CodexDreamSkinStudio");
    const expectedWrites = new Set([launchLog, path.join(stateDirectory, "codex-launch.log"),
      path.join(stateDirectory, "codex-launch-error.log")].map(file => path.relative(root, file)));
    const withoutExpectedWrites = entries => entries.filter(([file]) => !expectedWrites.has(file));
    const launchBaseline = withoutExpectedWrites(await snapshot(root));
    for (const profile of [undefined, customProfile]) {
      await writeFile(launchLog, "");
      const result = spawnSync("/bin/bash", ["-c", `
set -euo pipefail
. "$1"
NODE="$FIXTURE_NODE"
CODEX_BUNDLE="$CODEX_APP_BUNDLE"
CODEX_EXE="$CODEX_BUNDLE/Contents/MacOS/ChatGPT"
codex_main_pids() { return 0; }
codex_is_running() { return 1; }
launch_codex_with_cdp 9341
wait
launch_codex_normally
`, "fixture", path.join(launchScripts, "common-macos.sh")], {
        cwd: root,
        env: { ...environment, CFFIXED_USER_HOME: homeAlias, TMPDIR: otherHome, FIXTURE_NODE: process.execPath,
          FIXTURE_RECORDER: recorder, FIXTURE_LAUNCH_LOG: launchLog, FIXTURE_OS_TEMP: operatingSystemTemp,
          ...(profile === undefined ? {} : { CODEX_HOME: profile }) },
        encoding: "utf8", timeout: 15000,
      });
      assert.equal(result.error, undefined, `Launch fixture failed: ${result.error?.message}`);
      assert.equal(result.status, 0, `The real launch functions failed: ${result.stdout}\n${result.stderr}`);
      const calls = (await readFile(launchLog, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
      const cleanEnvironment = { HOME: home, CODEX_HOME: profile ?? defaultProfile, CFFIXED_USER_HOME: null, TMPDIR: operatingSystemTemp };
      assert.deepEqual(calls, [
        { command: "open", argv: ["-na", fakeApp, "--args", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9341"], environment: cleanEnvironment },
        { command: "nohup", argv: [path.join(fakeApp, "Contents", "MacOS", "ChatGPT"), "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9341"], environment: cleanEnvironment },
        { command: "open", argv: ["-na", fakeApp], environment: cleanEnvironment },
      ], "CDP, fallback and normal launch must all preserve the chosen profile and clean inherited environment overrides.");
      assert.deepEqual(withoutExpectedWrites(await snapshot(root)), launchBaseline,
        "Launch verification changed fixture data outside its explicit launch logs.");
      for (const [file, content] of sentinels) assert.equal(await readFile(file, "utf8"), content);
    }
    console.log("PASS: real CDP, fallback and normal launch functions preserve both default and custom profiles with clean child environments.");
  } else {
    console.log("SKIP: shell entry-point isolation requires macOS.");
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log("PASS: isolated launch environment validation preserves profiles and rejects contaminated homes without writes.");
