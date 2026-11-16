import { readFile, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import type { PortableStatus } from '@survival-os/shared-types'
import { assertPortable, installState, loadInstaller, portablePaths } from '../../utils/portable'

/** Estado de la versión portable: dónde se ejecuta, espacio libre y plan de «Instalar en este equipo». */
export default defineEventHandler(async (): Promise<PortableStatus> => {
  assertPortable()
  const { root, data } = portablePaths()
  const s = await statfs(data).catch(() => null)
  const plan = await loadInstaller()
    .then((m) => m.installPlan(root))
    .catch(() => null)
  return {
    root,
    data,
    platform: process.platform,
    arch: process.arch,
    freeBytes: s ? s.bavail * s.bsize : null,
    install: plan ? { dest: plan.dest, installedHere: plan.same, update: plan.update, bytes: plan.bytes, copiesData: plan.copiesData, supported: !!plan.key } : null,
    installJob: { ...installState },
    share: await readFile(join(data, 'share.json'), 'utf8')
      .then((t) => JSON.parse(t) as PortableStatus['share'])
      .catch(() => ({ on: false, url: null, error: null })),
  }
})
