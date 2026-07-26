'use strict';

const { productName: PRODUCT_NAME } = require('./package.json');

if (!PRODUCT_NAME) {
  throw new Error('electron/package.json must define productName');
}

function configureAppIdentity(app, platform = process.platform) {
  // app.getPath('userData') is derived from app.name. electron-builder's
  // build.productName controls artifact names, but it does not set app.name
  // early enough for this lookup, so make the runtime identity explicit.
  app.setName(PRODUCT_NAME);

  if (platform === 'win32') {
    app.setAppUserModelId('com.paperweight.desktop');
  }
}

module.exports = { PRODUCT_NAME, configureAppIdentity };
