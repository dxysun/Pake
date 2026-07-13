import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const sourcePath = path.join(process.cwd(), "src-tauri/src/app/window.rs");

describe("macOS new-window handling (regression: #1194)", () => {
  it("creates popups via open_requested_window on every platform", () => {
    const source = fs.readFileSync(sourcePath, "utf-8");

    const blockStart = source.indexOf(
      "if allow_js_new_window || config.multi_window",
    );
    const blockEnd = source.indexOf(
      "// Add initialization scripts",
      blockStart,
    );
    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);

    const newWindowBlock = source.slice(blockStart, blockEnd);

    // The fix for #1194 unifies all platforms behind open_requested_window so
    // popups never reuse the opener WKWebViewConfiguration. Guard against
    // accidental reintroduction of NewWindowResponse::Allow which crashes
    // macOS 26 with WKUserContentController duplicate handler errors.
    expect(newWindowBlock).toContain("open_requested_window");
    expect(newWindowBlock).toContain("NewWindowResponse::Create");
    expect(newWindowBlock).not.toMatch(/NewWindowResponse::Allow\b/);
    expect(newWindowBlock).not.toMatch(/#\[cfg\(target_os = "macos"\)\]/);
  });

  it("does not clone the opener WKWebViewConfiguration on macOS popup features", () => {
    // The popup-features handler in build_window must never call
    // .with_webview_configuration(features.opener().target_configuration)
    // because the cloned configuration carries the parent's
    // WKScriptMessageHandler set, which WebKit refuses to register twice and
    // aborts the process on macOS 26.
    const source = fs.readFileSync(sourcePath, "utf-8");
    expect(source).not.toContain("with_webview_configuration");
    expect(source).not.toContain("target_configuration.clone()");
  });

  it("registers on_new_window when multi_window is true even without new_window", () => {
    // When --multi-window is used without --new-window, the on_new_window
    // handler must still be registered so WKWebView's native Cmd+N is
    // intercepted and denied, preventing duplicate windows from the menu
    // accelerator + native key handling double-fire.
    const source = fs.readFileSync(sourcePath, "utf-8");
    const blockStart = source.indexOf(
      "if allow_js_new_window || config.multi_window",
    );
    expect(blockStart).toBeGreaterThan(-1);

    const blockEnd = source.indexOf(
      "// Add initialization scripts",
      blockStart,
    );
    const newWindowBlock = source.slice(blockStart, blockEnd);

    // The handler must deny JS-initiated window.open() when --new-window is
    // not enabled, so only the menu can create new windows.
    expect(newWindowBlock).toContain("if !allow_js_new_window");
    expect(newWindowBlock).toContain("NewWindowResponse::Deny");
  });

  it("uses menu_creating_window flag to block WKWebView native Cmd+N duplicates", () => {
    // WKWebView's native Cmd+N passes a non-empty URL (the current page URL),
    // so the empty-URL guard alone is not enough. A flag is set in
    // open_additional_window_safe and checked in on_new_window to deny
    // native new-window requests that fire in parallel with the menu handler.
    const source = fs.readFileSync(sourcePath, "utf-8");

    // MultiWindowState must have the flag field
    expect(source).toContain("menu_creating_window: AtomicBool");

    // open_additional_window_safe must atomically check-and-set the flag,
    // returning early if a window creation is already in progress
    const safeFnStart = source.indexOf("pub fn open_additional_window_safe");
    const safeFnEnd = source.indexOf("\n}", safeFnStart);
    const safeFn = source.slice(safeFnStart, safeFnEnd);
    expect(safeFn).toContain("compare_exchange");
    expect(safeFn).toContain("Skipped duplicate window creation");

    // on_new_window handler must check the flag and deny
    const handlerStart = source.indexOf(
      "if allow_js_new_window || config.multi_window",
    );
    const handlerEnd = source.indexOf(
      "// Add initialization scripts",
      handlerStart,
    );
    const handlerBlock = source.slice(handlerStart, handlerEnd);
    expect(handlerBlock).toContain("is_menu_creating_window");
    expect(handlerBlock).toContain("NewWindowResponse::Deny");
  });
});
