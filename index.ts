#!/usr/bin/env node
import { createRequire } from 'node:module'
import { extname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { BuildOptions } from 'esbuild'
import type { lessLoader } from 'esbuild-plugin-less'

import { build, context } from 'esbuild'
import yargs from 'yargs/yargs'

export interface BundleOptions extends BuildOptions {
  bundleType?: 'js' | 'less'
  lessOptions?: Parameters<typeof lessLoader>[0]
}

export interface BundleOptionsMap {
  [bundleName: string]: Partial<BundleOptions>
}

export type ConfigureBondler = (env: 'production' | 'development') => BundleOptionsMap
declare global {
  interface ObjectConstructor {
    keys<T>(o: T): Array<keyof T>
    values<T>(o: T): Array<T[keyof T]>
    entries<T>(o: T): Array<[keyof T, T[keyof T]]>
  }
}

interface MainArgs<T extends BundleOptionsMap> {
  watch?: boolean
  production?: boolean
  options?: T
  bundle?: keyof T | 'all'
}

async function main<T extends BundleOptionsMap>({
  watch = false,
  production = false,
  options = {} as T,
  bundle = 'all',
}: MainArgs<T>) {
  const defaultBuildOptions: BuildOptions = {
    absWorkingDir: process.cwd(),
    bundle: true,
    minify: production,
    sourcemap: !production,
    logLevel: 'info',
  }

  const targets = Object.keys(options)

  if (bundle !== 'all') {
    if (!targets.includes(bundle)) {
      throw new Error(`Unknown bundle target "${bundle.toString()}"`)
    }
    targets.splice(0, targets.length, bundle)
  }

  const builders = targets.map(async target => {
    const { bundleType, lessOptions, ...esbuildOptions } = options[target]
    const buildOptions = {
      ...defaultBuildOptions,
      ...(esbuildOptions as Partial<BuildOptions>),
      plugins: bundleType === 'less' ? [(await import('esbuild-plugin-less')).lessLoader(lessOptions)] : [],
    } as const
    return watch ? (await context(buildOptions)).watch() : build(buildOptions)
  })
  return Promise.all(builders)
}

/**
 * ESM polyfill for `require.main === module`
 * @param {ImportMeta} meta
 * @returns {boolean}
 */
function esMain(meta: ImportMeta): boolean {
  const sub = (name: string) => name.replace(new RegExp(`[.]${extname(name)}$`), '')
  return sub(fileURLToPath(meta.url)) === sub(createRequire(meta.url).resolve(process.argv[1]))
}

if (esMain(import.meta)) {
  const argv = await yargs(process.argv.slice(2))
    .scriptName('\x1b[3mbond\x1b[0m-ler 🔫')
    .usage('$0 [options]')
    .demandOption('bundle', 'Please provide a target bundle to build/watch')
    .describe('b', 'Target bundle to build')
    .string('b')
    .alias('b', 'bundle')
    .boolean('w')
    .describe('w', 'Watch for changes')
    .alias('w', 'watch')
    .describe('p', 'Build for production')
    .boolean('p')
    .default('p', (process.env.NODE_ENV || process.env.DEFAULT_APP_ENV) === 'production')
    .alias('p', 'production')
    .describe('c', 'Path to config file')
    .default('c', 'bondler.config.mjs')
    .alias('c', 'config')
    .boolean('debug')
    .hide('debug')
    .version()
    .help()
    .strict().argv

  try {
    const configPath = resolve(process.cwd(), argv.config)
    const esImportUrl = pathToFileURL(configPath).toString()

    const bondlerConfig = (await import(esImportUrl)).default as ConfigureBondler

    const options = bondlerConfig(argv.production ? 'production' : 'development')

    const result = await main({ ...argv, options })

    if (!argv.watch) {
      console.error('🟢 Bundling complete!')
    }
    if (argv.debug) {
      console.log('Bundle options:', options)
      console.log('Build result:', JSON.stringify(result, null, 2))
    }
  } catch (error) {
    console.error('🔴 Bundling failed with error:', error)
    process.exit(1)
  }
}
