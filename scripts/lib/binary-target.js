'use strict';

const fs = require('fs');

const ELF_MACHINE = Object.freeze({
  x64: 62,
  arm64: 183,
});

function parseOptions(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const equals = arg.indexOf('=');
    if (equals !== -1) {
      options[arg.slice(2, equals)] = arg.slice(equals + 1);
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith('--')) {
      options[key] = value;
      i += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function readElfMachineBuffer(buffer, label = 'binary') {
  const header = buffer.subarray(0, 20);
  if (header.length < 20 || header[0] !== 0x7f || header.toString('ascii', 1, 4) !== 'ELF') {
    throw new Error(`${label} is not an ELF binary`);
  }
  const dataEncoding = header[5];
  if (dataEncoding === 1) return header.readUInt16LE(18);
  if (dataEncoding === 2) return header.readUInt16BE(18);
  throw new Error(`${label} has an unsupported ELF data encoding`);
}

function readElfMachine(file) {
  return readElfMachineBuffer(fs.readFileSync(file), file);
}

function assertLinuxElfArch(file, arch, label = file) {
  const expected = ELF_MACHINE[arch];
  if (!expected) throw new Error(`Unsupported Linux architecture: ${arch}`);
  const actual = readElfMachine(file);
  if (actual !== expected) {
    throw new Error(`${label} architecture mismatch: ELF machine ${actual}, expected ${expected} for ${arch}`);
  }
  return actual;
}

function assertLinuxElfBufferArch(buffer, arch, label = 'binary') {
  const expected = ELF_MACHINE[arch];
  if (!expected) throw new Error(`Unsupported Linux architecture: ${arch}`);
  const actual = readElfMachineBuffer(buffer, label);
  if (actual !== expected) {
    throw new Error(`${label} architecture mismatch: ELF machine ${actual}, expected ${expected} for ${arch}`);
  }
  return actual;
}

module.exports = { ELF_MACHINE, assertLinuxElfArch, assertLinuxElfBufferArch, parseOptions, readElfMachine, readElfMachineBuffer };
