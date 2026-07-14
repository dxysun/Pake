import path from 'path';
import fsExtra from 'fs-extra';

import combineFiles from '@/utils/combine';
import logger from '@/options/logger';
import { handleIcon } from '@/options/icon';
import {
  generateSafeFilename,
  generateIdentifierSafeName,
  getSafeAppName,
  generateLinuxPackageName,
} from '@/utils/name';
import {
  PakeAppOptions,
  PakeTauriConfig,
  SupportedPlatform,
  TauriPlatform,
  WindowConfig,
} from '@/types';
import { tauriConfigDirectory, npmDirectory } from '@/utils/dir';
import { LINUX_TARGET_TYPES, resolveLinuxBundleTargets } from '@/utils/targets';

/**
 * Pure transform from CLI options to the window-config slice that gets
 * merged into pake.json. Exposed for snapshot testing so option drift
 * (e.g. a new flag added in cli-program.ts but forgotten here) is caught.
 *
 * Keep this function side-effect free.
 */
export function buildWindowConfigOverrides(
  options: PakeAppOptions,
  platform: SupportedPlatform = asSupportedPlatform(process.platform),
): Partial<WindowConfig> {
  const platformHideOnClose = options.hideOnClose ?? platform === 'darwin';
  const platformHideTitleBar =
    platform === 'darwin' ? options.hideTitleBar : false;
  const platformHideWindowDecorations =
    platform !== 'darwin' ? options.hideWindowDecorations : false;
  return {
    width: options.width,
    height: options.height,
    fullscreen: options.fullscreen,
    maximize: options.maximize,
    resizable: options.resizable ?? true,
    hide_title_bar: platformHideTitleBar,
    hide_window_decorations: platformHideWindowDecorations,
    activation_shortcut: options.activationShortcut,
    always_on_top: options.alwaysOnTop,
    dark_mode: options.darkMode,
    disabled_web_shortcuts: options.disabledWebShortcuts,
    hide_on_close: platformHideOnClose,
    incognito: options.incognito,
    title: options.title,
    enable_wasm: options.wasm,
    enable_drag_drop: options.enableDragDrop,
    start_to_tray: options.startToTray && options.showSystemTray,
    force_internal_navigation: options.forceInternalNavigation,
    internal_url_regex: options.internalUrlRegex,
    enable_find: options.enableFind,
    zoom: options.zoom,
    min_width: options.minWidth,
    min_height: options.minHeight,
    ignore_certificate_errors: options.ignoreCertificateErrors,
    new_window: options.newWindow,
  };
}

type PlatformIconInfo = {
  fileExt: string;
  path: string;
  defaultIcon: string;
  message: string;
};

function asSupportedPlatform(platform: NodeJS.Platform): SupportedPlatform {
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
    throw new Error(
      `Pake only supports win32, darwin, and linux; detected '${platform}'.`,
    );
  }
  return platform;
}

async function copyTemplateConfigs(): Promise<void> {
  const srcTauriDir = path.join(npmDirectory, 'src-tauri');
  await fsExtra.ensureDir(tauriConfigDirectory);

  const sourceFiles = [
    'tauri.conf.json',
    'tauri.macos.conf.json',
    'tauri.windows.conf.json',
    'tauri.linux.conf.json',
    'pake.json',
  ];

  await Promise.all(
    sourceFiles.map(async (file) => {
      const sourcePath = path.join(srcTauriDir, file);
      const destPath = path.join(tauriConfigDirectory, file);
      if (await fsExtra.pathExists(sourcePath)) {
        // Always overwrite to ensure clean config state for each build
        await fsExtra.copy(sourcePath, destPath, { overwrite: true });
      }
    }),
  );
}

async function handleLocalFile(
  url: string,
  useLocalFile: boolean,
  tauriConf: PakeTauriConfig,
): Promise<void> {
  const pathExists = await fsExtra.pathExists(url);
  if (pathExists) {
    logger.warn('✼ Your input might be a local file.');

    const fileName = path.basename(url);
    const dirName = path.dirname(url);
    const distDir = path.join(npmDirectory, 'dist');
    const distBakDir = path.join(npmDirectory, 'dist_bak');

    if (!useLocalFile) {
      const urlPath = path.join(distDir, fileName);
      await fsExtra.copy(url, urlPath);
    } else {
      fsExtra.moveSync(distDir, distBakDir, { overwrite: true });
      fsExtra.copySync(dirName, distDir, { overwrite: true });

      const filesToCopyBack = ['cli.js'];
      await Promise.all(
        filesToCopyBack.map((file) =>
          fsExtra.copy(path.join(distBakDir, file), path.join(distDir, file)),
        ),
      );
    }

    tauriConf.pake.windows[0].url = fileName;
    tauriConf.pake.windows[0].url_type = 'local';
  } else {
    tauriConf.pake.windows[0].url_type = 'web';
  }
}

export function buildLinuxDesktopContent(
  name: string,
  title: string | undefined,
  linuxBinaryName: string,
): string {
  const chineseName = title && /[\u4e00-\u9fa5]/.test(title) ? title : null;

  return `[Desktop Entry]
Version=1.0
Type=Application
Name=${name}
${chineseName ? `Name[zh_CN]=${chineseName}` : ''}
Comment=${name}
Exec=${linuxBinaryName}
Icon=${linuxBinaryName}
Categories=Network;WebBrowser;Utility;
MimeType=text/html;text/xml;application/xhtml_xml;
StartupNotify=true
Terminal=false
`;
}

async function mergeLinuxConfig(
  options: PakeAppOptions,
  name: string,
  tauriConf: PakeTauriConfig,
  linuxBinaryName: string,
): Promise<void> {
  const linuxBundle = tauriConf.bundle.linux;
  if (!linuxBundle) {
    throw new Error(
      'Linux bundle configuration is missing from tauri.linux.conf.json; cannot build Linux target.',
    );
  }
  delete linuxBundle.deb.files;

  const linuxName = generateLinuxPackageName(name);
  const desktopFileName = `com.pake.${linuxName}.desktop`;
  const desktopContent = buildLinuxDesktopContent(
    name,
    options.title,
    linuxBinaryName,
  );

  const srcAssetsDir = path.join(npmDirectory, 'src-tauri/assets');
  const srcDesktopFilePath = path.join(srcAssetsDir, desktopFileName);
  await fsExtra.ensureDir(srcAssetsDir);
  await fsExtra.writeFile(srcDesktopFilePath, desktopContent);

  const desktopInstallPath = `/usr/share/applications/${desktopFileName}`;
  linuxBundle.deb.files = {
    [desktopInstallPath]: `assets/${desktopFileName}`,
  };

  if (!linuxBundle.rpm) {
    linuxBundle.rpm = {};
  }
  linuxBundle.rpm.files = {
    [desktopInstallPath]: `assets/${desktopFileName}`,
  };

  // options.targets reaches here already stripped of any -arm64 suffix by the
  // LinuxBuilder constructor, and may carry several comma-separated formats
  // (e.g. the distro-aware default "deb,appimage"). Validate the parsed list
  // rather than string-matching the whole value, so a valid multi-target
  // default no longer trips the "must be one of ..." warning on every build.
  const { bundleTargets, hasValidTarget } = resolveLinuxBundleTargets(
    options.targets,
  );

  if (hasValidTarget) {
    tauriConf.bundle.targets = bundleTargets;
  } else {
    logger.warn(
      `✼ The target must be one of ${LINUX_TARGET_TYPES.join(', ')}, the default 'deb' will be used.`,
    );
  }
}

export async function resolveSystemTrayIconPath(
  systemTrayIcon: string,
  defaultTrayIconPath: string,
  safeAppName: string,
  iconOutputDir = path.join(npmDirectory, 'src-tauri/png'),
): Promise<string> {
  if (systemTrayIcon.length === 0) {
    return defaultTrayIconPath;
  }

  try {
    const iconExt = path.extname(systemTrayIcon).toLowerCase();
    if (iconExt !== '.png' && iconExt !== '.ico') {
      logger.warn(
        `✼ System tray icon must be .ico or .png, but you provided ${iconExt}.`,
      );
      logger.warn(`✼ Default system tray icon will be used.`);
      return defaultTrayIconPath;
    }

    if (!(await fsExtra.pathExists(systemTrayIcon))) {
      logger.warn(`✼ System tray icon "${systemTrayIcon}" was not found.`);
      logger.warn(`✼ Default system tray icon will be used.`);
      return defaultTrayIconPath;
    }

    const trayIconPath = `png/${safeAppName}${iconExt}`;
    const trayIcoPath = path.join(iconOutputDir, `${safeAppName}${iconExt}`);
    await fsExtra.copy(systemTrayIcon, trayIcoPath);
    return trayIconPath;
  } catch (err) {
    logger.warn(
      `✼ Failed to apply system tray icon "${systemTrayIcon}": ${err instanceof Error ? err.message : String(err)}`,
    );
    logger.warn(`✼ Default system tray icon will remain unchanged.`);
    return defaultTrayIconPath;
  }
}

async function mergeIcons(
  options: PakeAppOptions,
  name: string,
  tauriConf: PakeTauriConfig,
  platform: SupportedPlatform,
  safeAppName: string,
): Promise<void> {
  const platformIconMap: Record<SupportedPlatform, PlatformIconInfo> = {
    win32: {
      fileExt: '.ico',
      path: `png/${safeAppName}_256.ico`,
      defaultIcon: 'png/icon_256.ico',
      message: 'Windows icon must be .ico and 256x256px.',
    },
    linux: {
      fileExt: '.png',
      path: `png/${generateLinuxPackageName(name)}_512.png`,
      defaultIcon: 'png/icon_512.png',
      message: 'Linux icon must be .png and 512x512px.',
    },
    darwin: {
      fileExt: '.icns',
      path: `icons/${safeAppName}.icns`,
      defaultIcon: 'icons/icon.icns',
      message: 'macOS icon must be .icns type.',
    },
  };

  const iconInfo = platformIconMap[platform];
  // Use original icon path for tray PNG generation (before handleIcon converts it)
  const originalIconPath = (options as any)._originalIconPath || options.icon;
  const resolvedIconPath = originalIconPath ? path.resolve(originalIconPath) : null;
  const exists = resolvedIconPath && (await fsExtra.pathExists(resolvedIconPath));

  if (exists && options.icon) {
    // For macOS tray icon, create PNG from the original input file first
    // (before handleIcon converts it to ICNS which sharp can't read)
    let trayPngPath: string | null = null;
    if (platform === 'darwin' && resolvedIconPath) {
      trayPngPath = `png/${safeAppName}_tray.png`;
      const trayPngFullPath = path.join(npmDirectory, 'src-tauri', trayPngPath);
      try {
        await fsExtra.ensureDir(path.dirname(trayPngFullPath));
        const sharp = (await import('sharp')).default;
        await sharp(resolvedIconPath)
          .resize(256, 256, { fit: 'contain' })
          .ensureAlpha()
          .png()
          .toFile(trayPngFullPath);
        logger.info(`✵ System tray icon created: ${trayPngPath}`);
      } catch (error) {
        logger.warn(`Failed to create tray PNG from input: ${error instanceof Error ? error.message : String(error)}`);
        trayPngPath = null;
      }
    }

    // Use handleIcon to process and convert the icon to platform-specific format
    const processedIconPath = await handleIcon(options, tauriConf.pake.windows[0]?.url);
    
    if (processedIconPath && (await fsExtra.pathExists(processedIconPath))) {
      const iconPath = path.join(npmDirectory, 'src-tauri/', iconInfo.path);
      
      try {
        await fsExtra.ensureDir(path.dirname(iconPath));
        await fsExtra.copy(processedIconPath, iconPath);
        tauriConf.bundle.icon = [iconInfo.path];
        tauriConf.bundle.resources = [iconInfo.path];
        logger.info(`✵ Icon set to: ${iconInfo.path}`);
      } catch (error) {
        logger.warn(
          `✼ Failed to copy icon: ${error instanceof Error ? error.message : String(error)}`,
        );
        tauriConf.bundle.icon = [iconInfo.defaultIcon];
      }

      // Set tray icon path
      if (platform === 'darwin') {
        if (trayPngPath) {
          tauriConf.pake.system_tray_path = trayPngPath;
        } else {
          // Fallback to default PNG for tray icon (ICNS is not supported for tray on macOS)
          tauriConf.pake.system_tray_path = 'png/icon_512.png';
        }
      } else {
        tauriConf.pake.system_tray_path = iconInfo.path;
      }
    } else {
      logger.warn('✼ Icon processing failed, using default icon.');
      tauriConf.bundle.icon = [iconInfo.defaultIcon];
      tauriConf.pake.system_tray_path = platform === 'darwin' ? 'png/icon_512.png' : iconInfo.defaultIcon;
    }
  } else {
    // No custom icon specified, use default
    tauriConf.bundle.icon = [iconInfo.defaultIcon];
    tauriConf.pake.system_tray_path = platform === 'darwin' ? 'png/icon_512.png' : iconInfo.defaultIcon;
  }

  // Handle --system-tray-icon if explicitly specified (overrides auto-generated tray icon)
  if (options.systemTrayIcon) {
    const appIconPath = tauriConf.bundle.icon![0];
    const defaultTrayIconPath = platform === 'darwin' ? 'png/icon_512.png' : appIconPath;
    const trayIconPath = await resolveSystemTrayIconPath(
      options.systemTrayIcon,
      defaultTrayIconPath,
      safeAppName,
    );
    tauriConf.pake.system_tray_path = trayIconPath;
  }

  // Set Tauri v2 tray icon configuration (required for tray icon to work)
  if (tauriConf.pake.system_tray && tauriConf.pake.system_tray_path) {
    tauriConf.app.trayIcon = {
      iconPath: tauriConf.pake.system_tray_path,
      iconAsTemplate: platform === 'darwin',
      id: 'pake-tray',
    };
  }
}

async function injectCustomCode(
  options: PakeAppOptions,
  tauriConf: PakeTauriConfig,
): Promise<void> {
  const { inject, proxyUrl, multiInstance, multiWindow, wasm } = options;
  const injectFilePath = path.join(
    npmDirectory,
    'src-tauri/src/inject/custom.js',
  );

  if (inject?.length > 0) {
    const injectArray = Array.isArray(inject) ? inject : [inject];
    if (
      !injectArray.every(
        (item) => item.endsWith('.css') || item.endsWith('.js'),
      )
    ) {
      logger.error('The injected file must be in either CSS or JS format.');
      return;
    }
    const files = injectArray.map((filepath) =>
      path.isAbsolute(filepath) ? filepath : path.join(process.cwd(), filepath),
    );
    tauriConf.pake.inject = files;
    await combineFiles(files, injectFilePath);
  } else {
    tauriConf.pake.inject = [];
    await fsExtra.writeFile(injectFilePath, '');
  }

  tauriConf.pake.proxy_url = proxyUrl || '';
  tauriConf.pake.multi_instance = multiInstance;
  tauriConf.pake.multi_window = multiWindow;

  if (wasm) {
    tauriConf.app.security = {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    };
  }
}

async function generateMacEntitlements(
  camera: boolean,
  microphone: boolean,
): Promise<void> {
  const entitlementEntries: string[] = [];
  if (camera) {
    entitlementEntries.push(
      '    <key>com.apple.security.device.camera</key>\n    <true/>',
    );
  }
  if (microphone) {
    entitlementEntries.push(
      '    <key>com.apple.security.device.audio-input</key>\n    <true/>',
    );
  }
  const entitlementsContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
${entitlementEntries.join('\n')}
  </dict>
</plist>
`;
  const entitlementsPath = path.join(
    npmDirectory,
    'src-tauri',
    'entitlements.plist',
  );
  await fsExtra.writeFile(entitlementsPath, entitlementsContent);
}

async function writeAllConfigs(
  tauriConf: PakeTauriConfig,
  platform: SupportedPlatform,
): Promise<void> {
  const platformConfigPaths: Record<SupportedPlatform, string> = {
    win32: 'tauri.windows.conf.json',
    darwin: 'tauri.macos.conf.json',
    linux: 'tauri.linux.conf.json',
  };

  const configPath = path.join(
    tauriConfigDirectory,
    platformConfigPaths[platform],
  );
  const bundleConf = { bundle: tauriConf.bundle };
  await fsExtra.outputJSON(configPath, bundleConf, { spaces: 4 });

  const pakeConfigPath = path.join(tauriConfigDirectory, 'pake.json');
  await fsExtra.outputJSON(pakeConfigPath, tauriConf.pake, { spaces: 4 });

  const tauriConf2 = JSON.parse(JSON.stringify(tauriConf));
  delete tauriConf2.pake;
  if (process.env.NODE_ENV === 'development') {
    tauriConf2.bundle = bundleConf.bundle;
  }
  const configJsonPath = path.join(tauriConfigDirectory, 'tauri.conf.json');
  await fsExtra.outputJSON(configJsonPath, tauriConf2, { spaces: 4 });
}

export async function mergeConfig(
  url: string,
  options: PakeAppOptions,
  tauriConf: PakeTauriConfig,
) {
  await copyTemplateConfigs();

  const {
    appVersion,
    userAgent,
    showSystemTray,
    useLocalFile,
    identifier,
    name = 'pake-app',
    installerLanguage,
    wasm,
    camera,
    microphone,
  } = options;

  const platform = asSupportedPlatform(process.platform);
  if (options.hideTitleBar && platform !== 'darwin') {
    logger.warn(
      '✼ --hide-title-bar is only supported on macOS and will be ignored on this platform.',
    );
  }
  if (options.hideWindowDecorations && platform === 'darwin') {
    logger.warn(
      '✼ --hide-window-decorations is only supported on Windows and Linux and will be ignored on this platform.',
    );
  }
  const tauriConfWindowOptions = buildWindowConfigOverrides(options, platform);
  Object.assign(tauriConf.pake.windows[0], { url, ...tauriConfWindowOptions });

  tauriConf.productName = name;
  tauriConf.identifier = identifier;
  tauriConf.version = appVersion;

  const linuxBinaryName = `pake-${generateLinuxPackageName(name)}`;
  tauriConf.mainBinaryName =
    platform === 'linux'
      ? linuxBinaryName
      : `pake-${generateIdentifierSafeName(name)}`;

  if (platform === 'win32') {
    const windowsBundle = tauriConf.bundle.windows;
    if (!windowsBundle) {
      throw new Error(
        'Windows bundle configuration is missing from tauri.windows.conf.json; cannot build Windows target.',
      );
    }
    windowsBundle.wix.language[0] = installerLanguage;
  }

  await handleLocalFile(url, useLocalFile, tauriConf);

  const platformMap: Record<SupportedPlatform, TauriPlatform> = {
    win32: 'windows',
    linux: 'linux',
    darwin: 'macos',
  };
  const currentPlatform = platformMap[platform];

  if (userAgent.length > 0) {
    tauriConf.pake.user_agent[currentPlatform] = userAgent;
  }
  tauriConf.pake.system_tray[currentPlatform] = showSystemTray;

  if (platform === 'linux') {
    await mergeLinuxConfig(options, name, tauriConf, linuxBinaryName);
  }

  if (platform === 'darwin') {
    const validMacTargets = ['app', 'dmg'];
    if (validMacTargets.includes(options.targets)) {
      tauriConf.bundle.targets = [options.targets];
    }
  }

  const safeAppName = getSafeAppName(name);
  await mergeIcons(options, name, tauriConf, platform, safeAppName);

  await injectCustomCode(options, tauriConf);

  if (platform === 'darwin') {
    await generateMacEntitlements(camera, microphone);
  }

  await writeAllConfigs(tauriConf, platform);
}
