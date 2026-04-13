import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { SettingsModal } from './components/SettingsModal';
import { OllamaOnboarding } from './components/OllamaOnboarding';
import { ModelLibrary } from './components/ModelLibrary';
import { useConversations } from './stores/conversations';
import { useSettings } from './stores/settings';
import { useOllama } from './stores/ollama';
import { useModels } from './stores/models';
import { useStreamingChat } from './hooks/useStreamingChat';

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const refreshConversations = useConversations((s) => s.refresh);
  const refreshSettings = useSettings((s) => s.refresh);
  const initOllama = useOllama((s) => s.init);
  const initModels = useModels((s) => s.init);
  const ollamaStatus = useOllama((s) => s.status);
  const conversations = useConversations((s) => s.conversations);
  const activeId = useConversations((s) => s.activeId);
  const selectConversation = useConversations((s) => s.selectConversation);

  const { streamingMessageId } = useStreamingChat();

  // Initial load: settings, ollama daemon, installed models, conversations.
  useEffect(() => {
    void (async () => {
      await Promise.all([refreshSettings(), initOllama(), initModels()]);
      await refreshConversations();
    })();
  }, [refreshConversations, refreshSettings, initOllama, initModels]);

  // Auto-select the first conversation on load or when the active one
  // goes away.
  useEffect(() => {
    if (!activeId && conversations.length > 0) {
      void selectConversation(conversations[0].id);
    }
  }, [activeId, conversations, selectConversation]);

  // Show onboarding until Ollama is running with at least one model, OR the
  // user explicitly dismisses it.
  const needsOnboarding =
    !onboardingDismissed &&
    ollamaStatus.state !== 'checking' &&
    !(ollamaStatus.state === 'running' && ollamaStatus.hasModels);

  return (
    <div className="flex h-screen">
      <Sidebar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenLibrary={() => setLibraryOpen(true)}
      />
      <ChatView
        streamingMessageId={streamingMessageId}
        onOpenLibrary={() => setLibraryOpen(true)}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ModelLibrary
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
      />
      {needsOnboarding && (
        <OllamaOnboarding onDismiss={() => setOnboardingDismissed(true)} />
      )}
    </div>
  );
}
