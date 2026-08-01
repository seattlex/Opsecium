'use strict'

// Bridge for the browser chrome and the settings window. Nothing generic is
// exposed - every call is a named operation the main process implements.

const { contextBridge, ipcRenderer } = require('electron')

const listeners = new Map()

function on (channel, handler) {
  const wrapped = (_event, payload) => handler(payload)
  ipcRenderer.on(channel, wrapped)
  listeners.set(handler, { channel, wrapped })
  return () => {
    const entry = listeners.get(handler)
    if (entry) {
      ipcRenderer.removeListener(entry.channel, entry.wrapped)
      listeners.delete(handler)
    }
  }
}

contextBridge.exposeInMainWorld('opsecium', {
  tabs: {
    state: () => ipcRenderer.invoke('tabs:state'),
    create: (url) => ipcRenderer.invoke('tabs:new', url),
    close: (id) => ipcRenderer.invoke('tabs:close', id),
    select: (id) => ipcRenderer.invoke('tabs:select', id),
    onState: (handler) => on('tabs:state', handler)
  },
  nav: {
    load: (input) => ipcRenderer.invoke('nav:load', input),
    action: (action) => ipcRenderer.invoke('nav:action', action)
  },
  ua: {
    list: () => ipcRenderer.invoke('ua:list'),
    preview: (ua) => ipcRenderer.invoke('ua:preview', ua),
    set: (payload) => ipcRenderer.invoke('ua:set', payload),
    onChange: (handler) => on('identity:changed', handler)
  },
  vpn: {
    status: () => ipcRenderer.invoke('vpn:status'),
    toggle: () => ipcRenderer.invoke('vpn:toggle'),
    connect: () => ipcRenderer.invoke('vpn:connect'),
    disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
    regions: () => ipcRenderer.invoke('vpn:regions'),
    onStatus: (handler) => on('vpn:status', handler)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    patch: (partial) => ipcRenderer.invoke('settings:patch', partial),
    reset: () => ipcRenderer.invoke('settings:reset'),
    open: () => ipcRenderer.invoke('settings:open'),
    onChange: (handler) => on('settings:changed', handler)
  },
  privacy: {
    clear: () => ipcRenderer.invoke('privacy:clear')
  }
})
