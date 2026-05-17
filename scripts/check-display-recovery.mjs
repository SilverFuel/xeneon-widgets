import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const mainWindow = readWorkspaceFile("app/MainWindow.xaml.cs");
const bridgeManager = readWorkspaceFile("app/BridgeManager.cs");

function readWorkspaceFile(relativePath) {
  const filePath = resolve(process.cwd(), relativePath);
  try {
    if (!existsSync(filePath)) {
      throw new Error("file does not exist");
    }

    return readFileSync(filePath, "utf8");
  } catch (error) {
    console.error(`Unable to read ${relativePath} at ${filePath}: ${error.message}`);
    process.exit(1);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  /SystemEvents\.DisplaySettingsChanged\s*\+=\s*HandleDisplaySettingsChanged/.test(mainWindow)
    && /SystemEvents\.DisplaySettingsChanged\s*-=\s*HandleDisplaySettingsChanged/.test(mainWindow),
  "main window must subscribe and unsubscribe display topology change handling"
);

assert(
  /HandleDisplaySettingsChanged[\s\S]+ScheduleDisplayTopologyRecovery/.test(mainWindow)
    && /Task\.Delay\(1200,\s*cancellationToken\)/.test(mainWindow),
  "display topology recovery must debounce monitor hotplug events"
);

assert(
  /RecoverFromDisplayTopologyChangeAsync[\s\S]+ConfigureWindow\(saveSelection:\s*false\)/.test(mainWindow)
    && /RecoverFromDisplayTopologyChangeAsync[\s\S]+NavigateDashboard\(forceReload:\s*true\)/.test(mainWindow),
  "display topology recovery must reposition without overwriting saved preference and reload the dashboard"
);

assert(
  /HandleProcessFailed[\s\S]+ScheduleWebViewRecovery/.test(mainWindow)
    && /ScheduleWebViewRecovery[\s\S]+NavigateDashboard\(forceReload:\s*true\)/.test(mainWindow),
  "WebView process failures must schedule dashboard recovery"
);

assert(
  /SelectDisplayTarget\(IReadOnlyList<DisplayTarget>\?\s*candidates\s*=\s*null,\s*bool\s+saveSelection\s*=\s*true\)/.test(bridgeManager)
    && /if\s*\(!saveSelection\)\s*\{\s*return selected;\s*\}/s.test(bridgeManager),
  "display selection must support non-persistent recovery after transient monitor changes"
);

console.log("checked display topology and WebView recovery");
