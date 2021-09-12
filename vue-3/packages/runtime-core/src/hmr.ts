/* eslint-disable no-restricted-globals */
import {
  ConcreteComponent,
  ComponentInternalInstance,
  ComponentOptions,
  InternalRenderFunction,
  ClassComponent,
  isClassComponent
} from './component'
import { queueJob, queuePostFlushCb } from './scheduler'
import { extend } from '@vue/shared'

export let isHmrUpdating = false

export const hmrDirtyComponents = new Set<ConcreteComponent>()

export interface HMRRuntime {
  createRecord: typeof createRecord
  rerender: typeof rerender
  reload: typeof reload
}

// Expose the HMR runtime on the global object
// This makes it entirely tree-shakable without polluting the exports and makes
// it easier to be used in toolings like vue-loader
// Note: for a component to be eligible for HMR it also needs the __hmrId option
// to be set so that its instances can be registered / removed.
if (__DEV__) {
  const globalObject: any =
    typeof global !== 'undefined'
      ? global
      : typeof self !== 'undefined'
      ? self
      : typeof window !== 'undefined'
      ? window
      : {}

  globalObject.__VUE_HMR_RUNTIME__ = {
    createRecord: tryWrap(createRecord),
    rerender: tryWrap(rerender),
    reload: tryWrap(reload)
  } as HMRRuntime
}

const map: Map<string, Set<ComponentInternalInstance>> = new Map()

export function registerHMR(instance: ComponentInternalInstance) {
  const id = instance.type.__hmrId!
  let record = map.get(id)
  if (!record) {
    createRecord(id)
    record = map.get(id)!
  }
  record.add(instance)
}

export function unregisterHMR(instance: ComponentInternalInstance) {
  map.get(instance.type.__hmrId!)!.delete(instance)
}

function createRecord(id: string): boolean {
  if (map.has(id)) {
    return false
  }
  map.set(id, new Set())
  return true
}

type HMRComponent = ComponentOptions | ClassComponent

function normalizeClassComponent(component: HMRComponent): ComponentOptions {
  return isClassComponent(component) ? component.__vccOpts : component
}

function rerender(id: string, newRender?: Function) {
  const record = map.get(id)
  if (!record) {
    return
  }
  // Create a snapshot which avoids the set being mutated during updates
  ;[...record].forEach(instance => {
    if (newRender) {
      instance.render = newRender as InternalRenderFunction
      normalizeClassComponent(instance.type as HMRComponent).render = newRender
    }
    instance.renderCache = []
    // this flag forces child components with slot content to update
    isHmrUpdating = true
    instance.update()
    isHmrUpdating = false
  })
}

function reload(id: string, newComp: HMRComponent) {
  const record = map.get(id)
  if (!record) return

  newComp = normalizeClassComponent(newComp)

  // create a snapshot which avoids the set being mutated during updates
  const instances = [...record]

  for (const instance of instances) {
    const oldComp = normalizeClassComponent(instance.type as HMRComponent)

    if (!hmrDirtyComponents.has(oldComp)) {
      // 1. Update existing comp definition to match new one
      extend(oldComp, newComp)
      for (const key in oldComp) {
        if (key !== '__file' && !(key in newComp)) {
          delete (oldComp as any)[key]
        }
      }
      // 2. mark definition dirty. This forces the renderer to replace the
      // component on patch.
      hmrDirtyComponents.add(oldComp)
    }

    // 3. invalidate options resolution cache
    instance.appContext.optionsCache.delete(instance.type as any)

    // 4. actually update
    if (instance.ceReload) {
      // custom element
      hmrDirtyComponents.add(oldComp)
      instance.ceReload((newComp as any).styles)
      hmrDirtyComponents.delete(oldComp)
    } else if (instance.parent) {
      // 4. Force the parent instance to re-render. This will cause all updated
      // components to be unmounted and re-mounted. Queue the update so that we
      // don't end up forcing the same parent to re-render multiple times.
      queueJob(instance.parent.update)
      // instance is the inner component of an async custom element
      // invoke to reset styles
      if (
        (instance.parent.type as ComponentOptions).__asyncLoader &&
        instance.parent.ceReload
      ) {
        instance.parent.ceReload((newComp as any).styles)
      }
    } else if (instance.appContext.reload) {
      // root instance mounted via createApp() has a reload method
      instance.appContext.reload()
    } else if (typeof window !== 'undefined') {
      // root instance inside tree created via raw render(). Force reload.
      window.location.reload()
    } else {
      console.warn(
        '[HMR] Root or manually mounted instance modified. Full reload required.'
      )
    }
  }

  // 5. make sure to cleanup dirty hmr components after update
  queuePostFlushCb(() => {
    for (const instance of instances) {
      hmrDirtyComponents.delete(
        normalizeClassComponent(instance.type as HMRComponent)
      )
    }
  })
}

function tryWrap(fn: (id: string, arg: any) => any): Function {
  return (id: string, arg: any) => {
    try {
      return fn(id, arg)
    } catch (e: any) {
      console.error(e)
      console.warn(
        `[HMR] Something went wrong during Vue component hot-reload. ` +
          `Full reload required.`
      )
    }
  }
}