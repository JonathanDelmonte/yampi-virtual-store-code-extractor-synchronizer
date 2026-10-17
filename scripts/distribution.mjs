export const iconSizes = [16, 24, 32, 48, 128];
// Variable typefaces under the SIL Open Font License, Latin and Latin Extended (Portuguese).
export const fontFiles = ['next', 'mono'].flatMap(family => ['latin', 'latin-ext'].map(subset => ({package: `@fontsource-variable/atkinson-hyperlegible-${family}`, name: `atkinson-hyperlegible-${family}-${subset}-wght-normal.woff2`})));
export const extensionFiles = ['manifest.json', 'background.js', 'bridge.js', 'panel.js', 'runner.js', 'zip-worker.js', 'panel.html', 'panel.css', 'guide.html', 'guide.js', 'runner.html', 'brand/zirtuno-logo.png', ...iconSizes.map(size => `icons/icon${size}.png`), ...fontFiles.map(file => `fonts/${file.name}`)];
