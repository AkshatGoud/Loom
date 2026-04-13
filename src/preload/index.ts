import { contextBridge, ipcRenderer } from 'electron';
import type {
  ChatSendInput,
  ChatStreamEvent,
  Conversation,
  ConversationCreateInput,
  IpcApi,
  ModelPullProgress,
  OllamaStatus,
  ProviderId
} from '../shared/types';

const api: IpcApi = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  },
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    hasOpenAiKey: () => ipcRenderer.invoke('settings:hasOpenAiKey')
  },
  providers: {
    listModels: (providerId: ProviderId) =>
      ipcRenderer.invoke('providers:listModels', providerId)
  },
  models: {
    listInstalled: () => ipcRenderer.invoke('models:listInstalled'),
    listCurated: () => ipcRenderer.invoke('models:listCurated'),
    pull: (name: string) => ipcRenderer.invoke('models:pull', name),
    cancelPull: (name: string) => ipcRenderer.invoke('models:cancelPull', name),
    delete: (name: string) => ipcRenderer.invoke('models:delete', name),
    show: (name: string) => ipcRenderer.invoke('models:show', name),
    onPullProgress: (handler) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        progress: ModelPullProgress
      ) => handler(progress);
      ipcRenderer.on('ollama:pullProgress', listener);
      return () => {
        ipcRenderer.removeListener('ollama:pullProgress', listener);
      };
    }
  },
  ollama: {
    getStatus: () => ipcRenderer.invoke('ollama:getStatus'),
    tryStart: () => ipcRenderer.invoke('ollama:tryStart'),
    unloadModel: (model: string) =>
      ipcRenderer.invoke('ollama:unloadModel', model),
    unloadAll: () => ipcRenderer.invoke('ollama:unloadAll'),
    onStatusChange: (handler) => {
      const listener = (_e: Electron.IpcRendererEvent, status: OllamaStatus) =>
        handler(status);
      ipcRenderer.on('ollama:status', listener);
      return () => {
        ipcRenderer.removeListener('ollama:status', listener);
      };
    }
  },
  conversations: {
    list: () => ipcRenderer.invoke('conversations:list'),
    get: (id: string) => ipcRenderer.invoke('conversations:get', id),
    create: (input: ConversationCreateInput) =>
      ipcRenderer.invoke('conversations:create', input),
    update: (id: string, patch: Partial<Conversation>) =>
      ipcRenderer.invoke('conversations:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('conversations:remove', id),
    listMessages: (id: string) =>
      ipcRenderer.invoke('conversations:listMessages', id)
  },
  chat: {
    send: (input: ChatSendInput) => ipcRenderer.invoke('chat:send', input),
    abort: (conversationId: string) =>
      ipcRenderer.invoke('chat:abort', conversationId),
    onStream: (handler) => {
      const listener = (_e: Electron.IpcRendererEvent, event: ChatStreamEvent) =>
        handler(event);
      ipcRenderer.on('chat:stream', listener);
      return () => {
        ipcRenderer.removeListener('chat:stream', listener);
      };
    }
  }
};

contextBridge.exposeInMainWorld('api', api);
