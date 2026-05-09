import { useEffect, useRef, useState } from "react";
import { Info, Trash2 } from "lucide-react";
import { ConfirmDialog, NoticeDialog, TextInputDialog } from "../components/dialogs/AppDialog";
import { AppShell } from "../components/layout/AppShell";
import { ChatPage } from "../pages/ChatPage";
import { SettingsPage } from "../pages/SettingsPage";
import { ToolboxPage } from "../pages/ToolboxPage";
import { WorkflowsPage } from "../pages/WorkflowsPage";
import {
  loadActiveChatId,
  loadAppearanceMode,
  loadChats,
  loadProjects,
  loadProviderSettings,
  saveActiveChatId,
  saveAppearanceMode,
  saveChats,
  saveProjects,
  saveProviderSettings,
} from "../lib/appStorage";
import { createEmptyChat, createId, createMessage, DEFAULT_PROJECT, sortChatsByUpdatedAt, titleFromMessage } from "../lib/chatUtils";
import { streamOpenRouterMessage } from "../services/openRouterClient";
import { getAppInfo } from "./tauriClient";
import type { AppInfo } from "../types/app";
import type { ChatSendInput, ChatSummary } from "../types/chat";
import type { PrimaryRoute } from "../types/navigation";
import type { ProjectSummary } from "../types/project";
import type { AppearanceMode, ProviderSettings } from "../types/settings";

export function App() {
  const [activeRoute, setActiveRoute] = useState<PrimaryRoute>("chat");
  const [chats, setChats] = useState<ChatSummary[]>(() => sortChatsByUpdatedAt(loadChats()));
  const [projects, setProjects] = useState<ProjectSummary[]>(() => mergeProjectsWithChats(loadProjects(), loadChats()));
  const [activeChatId, setActiveChatId] = useState(() => loadActiveChatId() || "");
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() => loadProviderSettings());
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() => loadAppearanceMode());
  const [appInfo, setAppInfo] = useState<AppInfo>({
    name: "Gilbert Codex",
    phase: "Local workspace",
    runtime: "Frontend preview",
    version: "0.1.0",
  });
  const [sendingChatId, setSendingChatId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [noticeDialog, setNoticeDialog] = useState<{ description?: string; title: string } | null>(null);
  const [pendingDeleteChatId, setPendingDeleteChatId] = useState<string | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectNameError, setProjectNameError] = useState<string | null>(null);
  const activeSendRef = useRef(0);
  const sendingRequestRef = useRef<number | null>(null);

  useEffect(() => {
    void getAppInfo().then(setAppInfo);
  }, []);

  useEffect(() => {
    saveChats(chats);
  }, [chats]);

  useEffect(() => {
    saveProjects(projects);
  }, [projects]);

  useEffect(() => {
    saveProviderSettings(providerSettings);
  }, [providerSettings]);

  useEffect(() => {
    saveAppearanceMode(appearanceMode);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");

    function applyAppearance() {
      const resolvedTheme = appearanceMode === "system" ? (mediaQuery.matches ? "light" : "dark") : appearanceMode;
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.themePreference = appearanceMode;
      document.documentElement.style.colorScheme = resolvedTheme;
    }

    applyAppearance();
    mediaQuery.addEventListener("change", applyAppearance);

    return () => mediaQuery.removeEventListener("change", applyAppearance);
  }, [appearanceMode]);

  useEffect(() => {
    if (activeChatId) {
      saveActiveChatId(activeChatId);
    }
  }, [activeChatId]);

  useEffect(() => {
    if (chats.some((chat) => chat.id === activeChatId && !chat.archived)) {
      return;
    }

    const nextProject = projects[0]?.name ?? DEFAULT_PROJECT;
    const nextChat = chats.find((chat) => !chat.archived) ?? createEmptyChat(nextProject);

    if (!chats.some((chat) => chat.id === nextChat.id)) {
      setChats([nextChat]);
    }

    setActiveChatId(nextChat.id);
  }, [activeChatId, chats, projects]);

  const activeChat =
    chats.find((chat) => chat.id === activeChatId && !chat.archived) ??
    chats.find((chat) => !chat.archived) ??
    createEmptyChat(projects[0]?.name ?? DEFAULT_PROJECT);

  function handleNewChat(project = DEFAULT_PROJECT) {
    const nextChat = createEmptyChat(project);

    setChats((currentChats) => sortChatsByUpdatedAt([nextChat, ...currentChats]));
    touchProject(project);
    setActiveChatId(nextChat.id);
    setActiveRoute("chat");
    setSearchOpen(false);
  }

  function handleSelectChat(chatId: string) {
    setActiveChatId(chatId);
    setActiveRoute("chat");
    setSearchOpen(false);
  }

  function handleSelectProject(project: string) {
    const projectChat = sortChatsByUpdatedAt(chats).find((chat) => !chat.archived && chat.project === project);

    if (projectChat) {
      handleSelectChat(projectChat.id);
      return;
    }

    handleNewChat(project);
  }

  function openCreateProjectDialog() {
    setSearchOpen(false);
    setProjectNameDraft("");
    setProjectNameError(null);
    setProjectDialogOpen(true);
  }

  function closeCreateProjectDialog() {
    setProjectDialogOpen(false);
    setProjectNameDraft("");
    setProjectNameError(null);
  }

  function confirmCreateProject() {
    const projectName = projectNameDraft.trim();

    if (!projectName) {
      setProjectNameError("Enter a project name.");
      return;
    }

    const existingProject = projects.find((project) => project.name.toLowerCase() === projectName.toLowerCase());

    if (existingProject) {
      setProjectNameError("A project with this name already exists.");
      return;
    }

    const now = new Date().toISOString();
    const nextProject: ProjectSummary = {
      createdAt: now,
      id: createId("project"),
      name: projectName,
      updatedAt: now,
    };
    const nextChat = createEmptyChat(projectName);

    setProjects((currentProjects) => sortProjectsByUpdatedAt([nextProject, ...currentProjects]));
    setChats((currentChats) => sortChatsByUpdatedAt([nextChat, ...currentChats]));
    setActiveChatId(nextChat.id);
    setActiveRoute("chat");
    setSearchOpen(false);
    closeCreateProjectDialog();
  }

  function handleTogglePin(chatId: string) {
    setChats((currentChats) =>
      sortChatsByUpdatedAt(
        currentChats.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                pinned: !chat.pinned,
                updatedAt: new Date().toISOString(),
              }
            : chat,
        ),
      ),
    );
  }

  function touchProject(projectName: string) {
    const now = new Date().toISOString();

    setProjects((currentProjects) => {
      const projectExists = currentProjects.some((project) => project.name.toLowerCase() === projectName.toLowerCase());

      if (!projectExists) {
        return sortProjectsByUpdatedAt([
          {
            createdAt: now,
            id: createId("project"),
            name: projectName,
            updatedAt: now,
          },
          ...currentProjects,
        ]);
      }

      return sortProjectsByUpdatedAt(
        currentProjects.map((project) =>
          project.name.toLowerCase() === projectName.toLowerCase()
            ? {
                ...project,
                updatedAt: now,
              }
            : project,
        ),
      );
    });
  }

  function handleDeleteChat(chatId: string) {
    const chatToDelete = chats.find((chat) => chat.id === chatId);

    if (!chatToDelete) {
      return;
    }

    if (chatId === sendingChatId) {
      setNoticeDialog({
        description: "Wait for the current response to finish, then delete the chat from the sidebar menu.",
        title: "Chat is still responding",
      });
      return;
    }

    setPendingDeleteChatId(chatId);
  }

  function confirmDeleteChat() {
    const chatToDelete = chats.find((chat) => chat.id === pendingDeleteChatId);

    if (!chatToDelete) {
      setPendingDeleteChatId(null);
      return;
    }

    if (chatToDelete.id === sendingChatId) {
      setPendingDeleteChatId(null);
      setNoticeDialog({
        description: "Wait for the current response to finish, then delete the chat from the sidebar menu.",
        title: "Chat is still responding",
      });
      return;
    }

    const nextChats = sortChatsByUpdatedAt(chats.filter((chat) => chat.id !== chatToDelete.id));

    if (chatToDelete.id === activeChatId) {
      const nextActiveChat = nextChats.find((chat) => !chat.archived) ?? createEmptyChat(chatToDelete.project || projects[0]?.name || DEFAULT_PROJECT);

      if (!nextChats.some((chat) => chat.id === nextActiveChat.id)) {
        nextChats.unshift(nextActiveChat);
      }

      setActiveChatId(nextActiveChat.id);
    }

    setChats(nextChats);
    setPendingDeleteChatId(null);
  }

  async function handleSendMessage(input: ChatSendInput) {
    if (sendingRequestRef.current !== null) {
      return;
    }

    const content = input.content.trim();
    const attachments = input.attachments;
    const currentChat = activeChat ?? createEmptyChat(DEFAULT_PROJECT);
    const requestId = activeSendRef.current + 1;
    const now = new Date().toISOString();
    const userMessage = createMessage("user", content, undefined, undefined, attachments);
    const assistantMessage = {
      ...createMessage("assistant", ""),
      isStreaming: true,
      thinking: providerSettings.thinking.enabled
        ? {
            effort: providerSettings.thinking.effort,
            startedAt: now,
          }
        : undefined,
    };
    const messagesForProvider = [...currentChat.messages, userMessage].filter((message) => message.status !== "error");

    activeSendRef.current = requestId;
    sendingRequestRef.current = requestId;
    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    setSendingChatId(currentChat.id);

    setChats((currentChats) => {
      const hasCurrentChat = currentChats.some((chat) => chat.id === currentChat.id);
      const updatedChat: ChatSummary = {
        ...currentChat,
        messages: [...currentChat.messages, userMessage, assistantMessage],
        title: currentChat.messages.length === 0 ? titleFromMessage(content, attachments) : currentChat.title,
        updatedAt: now,
      };

      const nextChats = hasCurrentChat ? currentChats.map((chat) => (chat.id === currentChat.id ? updatedChat : chat)) : [updatedChat, ...currentChats];

      return sortChatsByUpdatedAt(nextChats);
    });
    touchProject(currentChat.project);

    try {
      const assistantResponse = await streamOpenRouterMessage(providerSettings, messagesForProvider, (snapshot) => {
        setChats((currentChats) =>
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === assistantMessage.id
                      ? {
                          ...message,
                          content: snapshot.content,
                          reasoning: snapshot.reasoning,
                          thinking:
                            message.thinking && snapshot.content && !message.thinking.completedAt
                              ? {
                                  ...message.thinking,
                                  completedAt: new Date().toISOString(),
                                }
                              : message.thinking,
                        }
                      : message,
                  ),
                }
              : chat,
          ),
        );
      });

      setChats((currentChats) =>
        sortChatsByUpdatedAt(
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === assistantMessage.id
                      ? {
                          ...message,
                          content: assistantResponse.content,
                          isStreaming: false,
                          reasoning: assistantResponse.reasoning,
                          thinking: message.thinking
                            ? {
                                ...message.thinking,
                                completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                              }
                            : undefined,
                        }
                      : message,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : chat,
          ),
        ),
      );
      touchProject(currentChat.project);
    } catch (error) {
      const errorContent = error instanceof Error ? error.message : "The OpenRouter request failed.";

      setChats((currentChats) =>
        sortChatsByUpdatedAt(
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === assistantMessage.id
                      ? {
                          ...message,
                          content: errorContent,
                          isStreaming: false,
                          reasoning: undefined,
                          status: "error",
                          thinking: message.thinking
                            ? {
                                ...message.thinking,
                                completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                              }
                            : undefined,
                        }
                      : message,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : chat,
          ),
        ),
      );
      touchProject(currentChat.project);
    } finally {
      if (sendingRequestRef.current === requestId) {
        sendingRequestRef.current = null;
        setSendingChatId(null);
      }
    }
  }

  function renderPage() {
    if (activeRoute === "toolbox") {
      return <ToolboxPage />;
    }

    if (activeRoute === "workflows") {
      return <WorkflowsPage />;
    }

    if (activeRoute === "settings") {
      return (
        <SettingsPage
          appInfo={appInfo}
          appearanceMode={appearanceMode}
          settings={providerSettings}
          onAppearanceModeChange={setAppearanceMode}
          onSettingsChange={setProviderSettings}
        />
      );
    }

    return (
      <ChatPage
        appInfo={appInfo}
        chat={activeChat}
        hasApiKey={Boolean(providerSettings.openRouterApiKey.trim())}
        isSending={Boolean(sendingChatId)}
        model={providerSettings.model}
        onModelChange={(nextModel) => setProviderSettings((settings) => ({ ...settings, model: nextModel }))}
        onSendMessage={handleSendMessage}
        onThinkingChange={(nextThinking) => setProviderSettings((settings) => ({ ...settings, thinking: nextThinking }))}
        thinking={providerSettings.thinking}
        onTogglePin={() => activeChat && handleTogglePin(activeChat.id)}
      />
    );
  }

  const pendingDeleteChat = pendingDeleteChatId ? chats.find((chat) => chat.id === pendingDeleteChatId) : undefined;

  return (
    <>
      <AppShell
        activeChatId={activeChatId}
        activeRoute={activeRoute}
        appInfo={appInfo}
        chats={chats}
        projects={projects}
        searchOpen={searchOpen}
        sidebarOpen={sidebarOpen}
        onCreateProject={openCreateProjectDialog}
        onCloseSearch={() => setSearchOpen(false)}
        onDeleteChat={handleDeleteChat}
        onNewChat={handleNewChat}
        onOpenSearch={() => setSearchOpen(true)}
        onRouteChange={setActiveRoute}
        onShowAbout={() => setAboutOpen(true)}
        onSelectChat={handleSelectChat}
        onSelectProject={handleSelectProject}
        onTogglePin={handleTogglePin}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
      >
        {renderPage()}
      </AppShell>

      <TextInputDialog
        confirmLabel="Create project"
        description="Create a project and start its first chat."
        error={projectNameError}
        label="Project name"
        open={projectDialogOpen}
        placeholder="Project name"
        title="New project"
        value={projectNameDraft}
        onChange={(value) => {
          setProjectNameDraft(value);
          setProjectNameError(null);
        }}
        onClose={closeCreateProjectDialog}
        onSubmit={confirmCreateProject}
      />

      <ConfirmDialog
        confirmLabel="Delete chat"
        description="This removes the chat from local history."
        icon={Trash2}
        open={Boolean(pendingDeleteChat)}
        title="Delete chat?"
        tone="danger"
        onClose={() => setPendingDeleteChatId(null)}
        onConfirm={confirmDeleteChat}
      >
        {pendingDeleteChat ? (
          <dl className="dialog-detail-list">
            <div>
              <dt>Chat</dt>
              <dd>{pendingDeleteChat.title}</dd>
            </div>
            <div>
              <dt>Project</dt>
              <dd>{pendingDeleteChat.project}</dd>
            </div>
            <div>
              <dt>Messages</dt>
              <dd>{pendingDeleteChat.messages.length}</dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>

      <NoticeDialog
        description={noticeDialog?.description}
        open={Boolean(noticeDialog)}
        title={noticeDialog?.title ?? ""}
        onClose={() => setNoticeDialog(null)}
      />

      <NoticeDialog
        buttonLabel="Close"
        description="Desktop agent workspace"
        icon={Info}
        open={aboutOpen}
        title={appInfo.name}
        onClose={() => setAboutOpen(false)}
      >
        <dl className="dialog-detail-list">
          <div>
            <dt>Version</dt>
            <dd>{appInfo.version}</dd>
          </div>
          <div>
            <dt>Phase</dt>
            <dd>{appInfo.phase}</dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>{appInfo.runtime}</dd>
          </div>
        </dl>
      </NoticeDialog>
    </>
  );
}

function mergeProjectsWithChats(projects: ProjectSummary[], chats: ChatSummary[]) {
  const projectMap = new Map(projects.map((project) => [project.name.toLowerCase(), project]));

  for (const chat of chats) {
    if (projectMap.has(chat.project.toLowerCase())) {
      continue;
    }

    projectMap.set(chat.project.toLowerCase(), {
      createdAt: chat.updatedAt,
      id: createId("project"),
      name: chat.project,
      updatedAt: chat.updatedAt,
    });
  }

  return sortProjectsByUpdatedAt([...projectMap.values()]);
}

function sortProjectsByUpdatedAt(projects: ProjectSummary[]) {
  return [...projects].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}
