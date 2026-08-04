import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(backendRoot, '..')
const sourceRoots = [
    path.join(backendRoot, 'src'),
    path.join(backendRoot, 'scripts'),
    path.join(repositoryRoot, 'frontend', 'src')
]
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.svelte'])

const collectSourceFiles = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true })
    const nested = await Promise.all(entries.map(async (entry) => {
        const target = path.join(directory, entry.name)
        if (entry.isDirectory()) return collectSourceFiles(target)
        return sourceExtensions.has(path.extname(entry.name)) ? [target] : []
    }))
    return nested.flat()
}

describe('repository source hygiene', () => {
    it('contains no literal NUL byte in JavaScript or Svelte source', async () => {
        const files = (await Promise.all(sourceRoots.map(collectSourceFiles))).flat()
        const offenders = (await Promise.all(files.map(async (file) => (
            (await readFile(file)).includes(0) ? path.relative(repositoryRoot, file) : ''
        )))).filter(Boolean)
        expect(offenders).toEqual([])
    }, 30_000)
})
