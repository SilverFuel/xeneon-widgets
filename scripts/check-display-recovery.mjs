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
  !/SystemEvents\.DisplaySettingsChanged/.test(mainWindow)
    && !/HandleDisplaySettingsChanged/.test(mainWindow)
    && !/ScheduleDisplayTopologyRecovery/.test(mainWindow)
    && !/RecoverFromDisplayTopologyChangeAsync/.test(mainWindow),
  "main window must not react to Windows display settings changes automatically"
);

assert(
  /HandleActivated[\s\S]+ConfigureWindow\(saveSelection:\s*false\)/.test(mainWindow)
    && /ShowDisplayWindow[\s\S]+ConfigureWindow\(saveSelection:\s*false\)/.test(mainWindow),
  "automatic launch and tray show must position the window without saving display preference"
);

assert(
  !/ChangeDisplaySettings/.test(mainWindow)
    && !/SetDisplayConfig/.test(mainWindow)
    && !/ChangeDisplaySettings/.test(bridgeManager)
    && !/SetDisplayConfig/.test(bridgeManager),
  "native host must not call Windows APIs that change monitor topology or display modes"
);

assert(
  /HandleProcessFailed[\s\S]+ScheduleWebViewRecovery/.test(mainWindow)
    && /ScheduleWebViewRecovery[\s\S]+NavigateDashboard\(forceReload:\s*true\)/.test(mainWindow)
    && /if\s*\(!DispatcherQueue\.TryEnqueue/.test(mainWindow)
    && /Failed to enqueue WebView recovery[\s\S]+Interlocked\.Exchange\(ref _webViewRecoveryScheduled,\s*0\)/.test(mainWindow),
  "WebView process failures must schedule dashboard recovery and clear the gate when enqueue fails"
);

assert(
  /SelectDisplayTarget\(IReadOnlyList<DisplayTarget>\?\s*candidates\s*=\s*null,\s*bool\s+saveSelection\s*=\s*true\)/.test(bridgeManager)
    && /if\s*\(!saveSelection\)\s*\{\s*return selected;\s*\}/s.test(bridgeManager),
  "display selection must support non-persistent recovery after transient monitor changes"
);

console.log("checked passive display targeting and WebView recovery");
