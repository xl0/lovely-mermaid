import{$ as e,A as t,D as n,E as r,F as i,G as a,H as o,I as s,J as c,L as l,M as u,O as d,Q as f,R as p,S as m,U as h,W as g,X as _,Y as v,Z as y,_ as b,b as x,ct as ee,et as S,f as C,h as te,k as w,l as T,mt as E,nt as D,p as ne,q as re,rt as O,st as ie,tt as k,v as ae}from"../chunks/bEiydLKe.js";import{l as A}from"../chunks/B4g3Gbp2.js";import"../chunks/xihTtKlq.js";import{i as oe}from"../chunks/CFIsWG6C.js";import{n as se,t as ce}from"../chunks/CnWIoYWZ.js";import{t as le}from"../chunks/BLH400lm.js";import{t as ue}from"../chunks/CtqiHthL.js";var de=`classDiagram
    direction LR

    class AgentSessionRuntime {
        -AgentSession currentSession
        -AgentSessionServices services
        -CreateRuntimeFactory createRuntime
        +newSession(options)
        +switchSession(path, options)
        +fork(entryId, options)
        +importFromJsonl(path, cwd)
        +dispose()
    }

    class AgentSessionServices {
        +string cwd
        +string agentDir
        +ModelRuntime modelRuntime
        +SettingsManager settingsManager
        +ResourceLoader resourceLoader
        +Diagnostic[] diagnostics
    }

    class AgentSession {
        +Agent agent
        +SessionManager sessionManager
        +SettingsManager settingsManager
        +prompt(text, options)
        +steer(text, images)
        +followUp(text, images)
        +compact(instructions)
        +navigateTree(targetId, options)
        +bindExtensions(bindings)
        +reload()
    }

    class Agent {
        +AgentState state
        +QueueMode steeringMode
        +QueueMode followUpMode
        +prompt(messages)
        +continue()
        +steer(message)
        +followUp(message)
        +subscribe(listener)
        +abort()
        +waitForIdle()
    }

    class AgentState {
        +string systemPrompt
        +Model model
        +ThinkingLevel thinkingLevel
        +AgentTool[] tools
        +AgentMessage[] messages
        +boolean isStreaming
        +AgentMessage streamingMessage
    }

    class AgentLoopConfig {
        +Model model
        +ThinkingLevel reasoning
        +Transport transport
        +ToolExecutionMode toolExecution
        +convertToLlm(messages)
        +transformContext(messages)
        +beforeToolCall(context)
        +afterToolCall(context)
    }

    class SessionManager {
        -SessionEntry[] entries
        -string leafId
        -string sessionFile
        +appendMessage(message)
        +appendCompaction(summary)
        +buildSessionContext()
        +getBranch(fromId)
        +getTree()
        +branch(entryId)
        +branchWithSummary(entryId, summary)
        +createBranchedSession(leafId)
    }

    class SessionEntry {
        <<interface>>
        +string type
        +string id
        +string parentId
        +string timestamp
    }

    class SettingsManager {
        -Settings globalSettings
        -Settings projectSettings
        +getCompactionSettings()
        +getRetrySettings()
        +getSteeringMode()
        +getFollowUpMode()
        +getDefaultModel()
        +applyOverrides(settings)
        +reload()
        +flush()
    }

    class ResourceLoader {
        <<interface>>
        +getExtensions()
        +getSkills()
        +getPrompts()
        +getThemes()
        +getAgentsFiles()
        +getSystemPrompt()
        +extendResources(paths)
        +reload(options)
    }

    class DefaultResourceLoader {
        -string cwd
        -string agentDir
        -SettingsManager settingsManager
        +reload(options)
        +extendResources(paths)
    }

    class ExtensionRunner {
        -Extension[] extensions
        -ExtensionRuntime runtime
        +emit(event)
        +emitInput(text, images, source)
        +emitContext(messages)
        +emitToolCall(event)
        +emitToolResult(event)
        +emitBeforeAgentStart(prompt)
        +getRegisteredCommands()
        +getAllRegisteredTools()
    }

    class ExtensionRuntime {
        +Map handlers
        +Map tools
        +Map commands
        +Map shortcuts
        +Map flags
        +Map messageRenderers
        +Map entryRenderers
        +registerProvider(name, config)
        +unregisterProvider(name)
    }

    class ExtensionAPI {
        <<interface>>
        +on(event, handler)
        +registerTool(definition)
        +registerCommand(name, options)
        +registerShortcut(key, options)
        +registerProvider(name, config)
        +sendMessage(message, options)
        +sendUserMessage(content, options)
        +appendEntry(type, data)
    }

    class ModelRuntime {
        -CredentialStore credentials
        -ModelsStore modelsStore
        -ProviderComposer composer
        +getProviders()
        +getModels(providerId)
        +getAvailable(providerId)
        +getAuth(model)
        +streamSimple(model, context)
        +refresh(options)
        +login(providerId, type)
        +registerProvider(id, config)
        +registerNativeProvider(provider)
    }

    class ModelRegistry {
        -ModelRuntime runtime
        +getAvailable()
        +getModel(provider, modelId)
        +registerProvider(name, config)
        +unregisterProvider(name)
    }

    class Model {
        <<pi-ai value>>
        +string id
        +string provider
        +string api
        +string baseUrl
        +boolean reasoning
        +number contextWindow
        +number maxTokens
    }

    class Provider {
        <<pi-ai interface>>
        +string id
        +string name
        +AuthMethod[] auth
        +Model[] models
        +stream(model, context, options)
    }

    class CredentialStore {
        <<interface>>
        +get(providerId)
        +set(providerId, credential)
        +delete(providerId)
        +list()
    }

    class ToolDefinition {
        <<interface>>
        +string name
        +string label
        +string description
        +Schema parameters
        +ExecutionMode executionMode
        +execute(callId, params, signal)
        +renderCall(args, options)
        +renderResult(result, options)
    }

    class AgentTool {
        <<agent-core interface>>
        +string name
        +string description
        +Schema parameters
        +execute(callId, args, signal)
    }

    class InteractiveMode {
        -AgentSessionRuntime runtime
        -TUI tui
        +init()
        +run()
        +stop()
        +rebindSession(session)
    }

    class PrintMode {
        <<function adapter>>
        +runPrintMode(runtime, options)
    }

    class RpcMode {
        <<function adapter>>
        +runRpcMode(runtime)
        +handleCommand(command)
        +createExtensionUIContext()
    }

    AgentSessionRuntime "1" *-- "1" AgentSessionServices : owns
    AgentSessionRuntime "1" *-- "1" AgentSession : replaces
    AgentSessionServices "1" *-- "1" SettingsManager
    AgentSessionServices "1" *-- "1" ResourceLoader
    AgentSessionServices "1" *-- "1" ModelRuntime
    AgentSession "1" *-- "1" Agent
    AgentSession "1" --> "1" SessionManager : persists through
    AgentSession "1" --> "1" ExtensionRunner : dispatches hooks
    AgentSession "1" --> "1" ModelRuntime : resolves auth and models
    AgentSession "1" --> "1" ResourceLoader : consumes resources
    Agent "1" *-- "1" AgentState
    Agent --> AgentLoopConfig : snapshots each run
    AgentLoopConfig --> Model : selects
    AgentLoopConfig --> "0..*" AgentTool : exposes
    SessionManager "1" *-- "0..*" SessionEntry : stores tree
    DefaultResourceLoader ..|> ResourceLoader
    DefaultResourceLoader --> SettingsManager : filters enabled resources
    ExtensionRunner "1" *-- "1" ExtensionRuntime
    ExtensionRunner --> ExtensionAPI : binds core actions
    ExtensionRunner --> ModelRegistry : provider facade
    ModelRegistry --> ModelRuntime : delegates
    ModelRuntime "1" *-- "1" CredentialStore
    ModelRuntime "1" o-- "0..*" Provider : composes
    Provider "1" o-- "0..*" Model : publishes
    ToolDefinition ..> AgentTool : wrapped as
    ExtensionAPI ..> ToolDefinition : registers
    InteractiveMode --> AgentSessionRuntime
    PrintMode --> AgentSessionRuntime
    RpcMode --> AgentSessionRuntime
    InteractiveMode ..> ExtensionAPI : supplies TUI context
    RpcMode ..> ExtensionAPI : supplies RPC UI context
`,fe=`erDiagram
    direction LR
    SESSION_HEADER {
        string type
        int version
        uuid id PK
        datetime timestamp
        string cwd
        string parentSession
    }

    SESSION_ENTRY {
        string type
        string id PK
        string parentId FK
        datetime timestamp
    }

    MESSAGE_ENTRY {
        string entryId PK
        string role
        json message
    }

    MODEL_CHANGE_ENTRY {
        string entryId PK
        string provider
        string modelId
    }

    THINKING_LEVEL_CHANGE_ENTRY {
        string entryId PK
        string thinkingLevel
    }

    COMPACTION_ENTRY {
        string entryId PK
        string summary
        string firstKeptEntryId FK
        int tokensBefore
        json retainedTail
        json usage
        json details
        boolean fromHook
    }

    BRANCH_SUMMARY_ENTRY {
        string entryId PK
        string fromId FK
        string summary
        json usage
        json details
        boolean fromHook
    }

    CUSTOM_ENTRY {
        string entryId PK
        string customType
        json data
    }

    CUSTOM_MESSAGE_ENTRY {
        string entryId PK
        string customType
        json content
        boolean display
        json details
    }

    LABEL_ENTRY {
        string entryId PK
        string targetId FK
        string label
    }

    SESSION_INFO_ENTRY {
        string entryId PK
        string name
    }

    AGENT_MESSAGE {
        string role
        datetime timestamp
        json content
    }

    USER_MESSAGE {
        string role
        json content
        datetime timestamp
    }

    ASSISTANT_MESSAGE {
        string role
        string api
        string provider
        string model
        string stopReason
        string errorMessage
        json usage
        datetime timestamp
    }

    TOOL_RESULT_MESSAGE {
        string role
        string toolCallId FK
        string toolName
        json content
        json details
        json usage
        boolean isError
        datetime timestamp
    }

    BASH_EXECUTION_MESSAGE {
        string role
        string command
        string output
        int exitCode
        boolean cancelled
        boolean truncated
        string fullOutputPath
        boolean excludeFromContext
    }

    CONTENT_BLOCK {
        string type
        int contentIndex
    }

    TEXT_CONTENT {
        string type
        string text
    }

    IMAGE_CONTENT {
        string type
        string mimeType
        string data
    }

    THINKING_CONTENT {
        string type
        string thinking
    }

    TOOL_CALL {
        string type
        string id PK
        string name
        json arguments
    }

    USAGE {
        int input
        int output
        int cacheRead
        int cacheWrite
        int totalTokens
        json cost
    }

    COMPACTION_SUMMARY_MESSAGE {
        string role
        string summary
        int tokensBefore
        datetime timestamp
    }

    BRANCH_SUMMARY_MESSAGE {
        string role
        string summary
        string fromId
        datetime timestamp
    }

    SESSION_HEADER ||--o{ SESSION_ENTRY : contains
    SESSION_ENTRY o|--o{ SESSION_ENTRY : parent_of
    SESSION_ENTRY ||--o| MESSAGE_ENTRY : may_be
    SESSION_ENTRY ||--o| MODEL_CHANGE_ENTRY : may_be
    SESSION_ENTRY ||--o| THINKING_LEVEL_CHANGE_ENTRY : may_be
    SESSION_ENTRY ||--o| COMPACTION_ENTRY : may_be
    SESSION_ENTRY ||--o| BRANCH_SUMMARY_ENTRY : may_be
    SESSION_ENTRY ||--o| CUSTOM_ENTRY : may_be
    SESSION_ENTRY ||--o| CUSTOM_MESSAGE_ENTRY : may_be
    SESSION_ENTRY ||--o| LABEL_ENTRY : may_be
    SESSION_ENTRY ||--o| SESSION_INFO_ENTRY : may_be

    MESSAGE_ENTRY ||--|| AGENT_MESSAGE : wraps
    AGENT_MESSAGE ||--o| USER_MESSAGE : variant
    AGENT_MESSAGE ||--o| ASSISTANT_MESSAGE : variant
    AGENT_MESSAGE ||--o| TOOL_RESULT_MESSAGE : variant
    AGENT_MESSAGE ||--o| BASH_EXECUTION_MESSAGE : variant
    AGENT_MESSAGE ||--o| COMPACTION_SUMMARY_MESSAGE : context_variant
    AGENT_MESSAGE ||--o| BRANCH_SUMMARY_MESSAGE : context_variant

    USER_MESSAGE ||--o{ CONTENT_BLOCK : contains
    ASSISTANT_MESSAGE ||--o{ CONTENT_BLOCK : contains
    TOOL_RESULT_MESSAGE ||--o{ CONTENT_BLOCK : contains
    CUSTOM_MESSAGE_ENTRY ||--o{ CONTENT_BLOCK : contains
    CONTENT_BLOCK ||--o| TEXT_CONTENT : variant
    CONTENT_BLOCK ||--o| IMAGE_CONTENT : variant
    CONTENT_BLOCK ||--o| THINKING_CONTENT : variant
    CONTENT_BLOCK ||--o| TOOL_CALL : variant

    ASSISTANT_MESSAGE ||--|| USAGE : reports
    TOOL_RESULT_MESSAGE ||--o| USAGE : may_report
    COMPACTION_ENTRY ||--o| USAGE : summarization_cost
    BRANCH_SUMMARY_ENTRY ||--o| USAGE : summarization_cost
    TOOL_CALL ||--o| TOOL_RESULT_MESSAGE : answered_by
    COMPACTION_ENTRY ||--o{ AGENT_MESSAGE : retains_tail
    COMPACTION_ENTRY }o--o| SESSION_ENTRY : first_kept
    BRANCH_SUMMARY_ENTRY }o--|| SESSION_ENTRY : summarizes_from
    LABEL_ENTRY }o--|| SESSION_ENTRY : labels
`,pe=`erDiagram
    SESSION_HEADER {
        string type
        int version
        uuid id PK
        datetime timestamp
        string cwd
        string parentSession
    }

    SESSION_ENTRY {
        string type
        string id PK
        string parentId FK
        datetime timestamp
    }

    MESSAGE_ENTRY {
        string entryId PK
        string role
        json message
    }

    MODEL_CHANGE_ENTRY {
        string entryId PK
        string provider
        string modelId
    }

    THINKING_LEVEL_CHANGE_ENTRY {
        string entryId PK
        string thinkingLevel
    }

    COMPACTION_ENTRY {
        string entryId PK
        string summary
        string firstKeptEntryId FK
        int tokensBefore
        json retainedTail
        json usage
        json details
        boolean fromHook
    }

    BRANCH_SUMMARY_ENTRY {
        string entryId PK
        string fromId FK
        string summary
        json usage
        json details
        boolean fromHook
    }

    CUSTOM_ENTRY {
        string entryId PK
        string customType
        json data
    }

    CUSTOM_MESSAGE_ENTRY {
        string entryId PK
        string customType
        json content
        boolean display
        json details
    }

    LABEL_ENTRY {
        string entryId PK
        string targetId FK
        string label
    }

    SESSION_INFO_ENTRY {
        string entryId PK
        string name
    }

    AGENT_MESSAGE {
        string role
        datetime timestamp
        json content
    }

    USER_MESSAGE {
        string role
        json content
        datetime timestamp
    }

    ASSISTANT_MESSAGE {
        string role
        string api
        string provider
        string model
        string stopReason
        string errorMessage
        json usage
        datetime timestamp
    }

    TOOL_RESULT_MESSAGE {
        string role
        string toolCallId FK
        string toolName
        json content
        json details
        json usage
        boolean isError
        datetime timestamp
    }

    BASH_EXECUTION_MESSAGE {
        string role
        string command
        string output
        int exitCode
        boolean cancelled
        boolean truncated
        string fullOutputPath
        boolean excludeFromContext
    }

    CONTENT_BLOCK {
        string type
        int contentIndex
    }

    TEXT_CONTENT {
        string type
        string text
    }

    IMAGE_CONTENT {
        string type
        string mimeType
        string data
    }

    THINKING_CONTENT {
        string type
        string thinking
    }

    TOOL_CALL {
        string type
        string id PK
        string name
        json arguments
    }

    USAGE {
        int input
        int output
        int cacheRead
        int cacheWrite
        int totalTokens
        json cost
    }

    COMPACTION_SUMMARY_MESSAGE {
        string role
        string summary
        int tokensBefore
        datetime timestamp
    }

    BRANCH_SUMMARY_MESSAGE {
        string role
        string summary
        string fromId
        datetime timestamp
    }

    SESSION_HEADER ||--o{ SESSION_ENTRY : contains
    SESSION_ENTRY o|--o{ SESSION_ENTRY : parent_of
    SESSION_ENTRY ||--o| MESSAGE_ENTRY : may_be
    SESSION_ENTRY ||--o| MODEL_CHANGE_ENTRY : may_be
    SESSION_ENTRY ||--o| THINKING_LEVEL_CHANGE_ENTRY : may_be
    SESSION_ENTRY ||--o| COMPACTION_ENTRY : may_be
    SESSION_ENTRY ||--o| BRANCH_SUMMARY_ENTRY : may_be
    SESSION_ENTRY ||--o| CUSTOM_ENTRY : may_be
    SESSION_ENTRY ||--o| CUSTOM_MESSAGE_ENTRY : may_be
    SESSION_ENTRY ||--o| LABEL_ENTRY : may_be
    SESSION_ENTRY ||--o| SESSION_INFO_ENTRY : may_be

    MESSAGE_ENTRY ||--|| AGENT_MESSAGE : wraps
    AGENT_MESSAGE ||--o| USER_MESSAGE : variant
    AGENT_MESSAGE ||--o| ASSISTANT_MESSAGE : variant
    AGENT_MESSAGE ||--o| TOOL_RESULT_MESSAGE : variant
    AGENT_MESSAGE ||--o| BASH_EXECUTION_MESSAGE : variant
    AGENT_MESSAGE ||--o| COMPACTION_SUMMARY_MESSAGE : context_variant
    AGENT_MESSAGE ||--o| BRANCH_SUMMARY_MESSAGE : context_variant

    USER_MESSAGE ||--o{ CONTENT_BLOCK : contains
    ASSISTANT_MESSAGE ||--o{ CONTENT_BLOCK : contains
    TOOL_RESULT_MESSAGE ||--o{ CONTENT_BLOCK : contains
    CUSTOM_MESSAGE_ENTRY ||--o{ CONTENT_BLOCK : contains
    CONTENT_BLOCK ||--o| TEXT_CONTENT : variant
    CONTENT_BLOCK ||--o| IMAGE_CONTENT : variant
    CONTENT_BLOCK ||--o| THINKING_CONTENT : variant
    CONTENT_BLOCK ||--o| TOOL_CALL : variant

    ASSISTANT_MESSAGE ||--|| USAGE : reports
    TOOL_RESULT_MESSAGE ||--o| USAGE : may_report
    COMPACTION_ENTRY ||--o| USAGE : summarization_cost
    BRANCH_SUMMARY_ENTRY ||--o| USAGE : summarization_cost
    TOOL_CALL ||--o| TOOL_RESULT_MESSAGE : answered_by
    COMPACTION_ENTRY ||--o{ AGENT_MESSAGE : retains_tail
    COMPACTION_ENTRY }o--o| SESSION_ENTRY : first_kept
    BRANCH_SUMMARY_ENTRY }o--|| SESSION_ENTRY : summarizes_from
    LABEL_ENTRY }o--|| SESSION_ENTRY : labels
`,me=`stateDiagram-v2
    direction LR

    [*] --> RuntimeCreation

    state "Create cwd-bound runtime" as RuntimeCreation {
        [*] --> LoadSettings
        LoadSettings --> ResolveProjectTrust
        ResolveProjectTrust --> DiscoverResources
        DiscoverResources --> LoadExtensions
        LoadExtensions --> RegisterProviders
        RegisterProviders --> RefreshLocalCatalogs
        RefreshLocalCatalogs --> ResolveSessionModel
        ResolveSessionModel --> RestoreThinkingLevel
        RestoreThinkingLevel --> BuildToolRegistry
        BuildToolRegistry --> BuildSystemPrompt
        BuildSystemPrompt --> HydrateSessionContext
        HydrateSessionContext --> BindExtensionCore
        BindExtensionCore --> [*]
    }

    RuntimeCreation --> Idle : session_start
    state "Idle and accepting input" as Idle

    Idle --> PromptPreflight : prompt

    state "Prompt preflight" as PromptPreflight {
        [*] --> CheckExtensionCommand
        CheckExtensionCommand --> CommandOutcome
        state CommandOutcome <<choice>>
        CommandOutcome --> ExecuteCommand : registered command
        CommandOutcome --> EmitInputHook : normal input
        ExecuteCommand --> PreflightHandled
        EmitInputHook --> InputOutcome
        state InputOutcome <<choice>>
        InputOutcome --> PreflightHandled : handled
        InputOutcome --> ExpandPrompt : continue or transform
        ExpandPrompt --> ExpandSkill
        ExpandSkill --> ExpandTemplate
        ExpandTemplate --> StreamingCheck
        StreamingCheck --> QueueBehavior
        state QueueBehavior <<choice>>
        QueueBehavior --> QueueSteering : active and steer
        QueueBehavior --> QueueFollowUp : active and follow-up
        QueueBehavior --> RejectMissingBehavior : active and unspecified
        QueueBehavior --> ValidateModel : inactive
        ValidateModel --> ValidateAuthentication
        ValidateAuthentication --> CheckPreTurnCompaction
        CheckPreTurnCompaction --> BeforeAgentStartHook
        BeforeAgentStartHook --> AssembleInputMessages
        AssembleInputMessages --> PreflightAccepted
        PreflightHandled --> [*]
        QueueSteering --> [*]
        QueueFollowUp --> [*]
        RejectMissingBehavior --> [*]
        PreflightAccepted --> [*]
    }

    PromptPreflight --> Idle : handled, queued, or rejected
    PromptPreflight --> Running : accepted new run

    state "Active agent run" as Running {
        state "Provider and tool loop" as AgentLoop {
            [*] --> AgentStart
            AgentStart --> StartTurn
            StartTurn --> Turn

            state "One assistant turn" as Turn {
                [*] --> RefreshTurnSnapshot
                RefreshTurnSnapshot --> TransformContextHook
                TransformContextHook --> ConvertToLlmMessages
                ConvertToLlmMessages --> FilterBlockedImages
                FilterBlockedImages --> ResolveRequestAuth
                ResolveRequestAuth --> MergeAttributionHeaders
                MergeAttributionHeaders --> BeforeProviderHeadersHook
                BeforeProviderHeadersHook --> BeforeProviderRequestHook
                BeforeProviderRequestHook --> ProviderStreaming
                ProviderStreaming --> AfterProviderResponseHook
                AfterProviderResponseHook --> ResponseOutcome

                state ResponseOutcome <<choice>>
                ResponseOutcome --> ResponseError : error or abort
                ResponseOutcome --> TurnComplete : final response
                ResponseOutcome --> ResolveToolCalls : tool use

                ResolveToolCalls --> ValidateToolArguments
                ValidateToolArguments --> ToolPreparationOutcome
                state ToolPreparationOutcome <<choice>>
                ToolPreparationOutcome --> ErrorToolResult : unknown or invalid
                ToolPreparationOutcome --> BeforeToolCallHook : valid
                BeforeToolCallHook --> ToolPermissionOutcome
                state ToolPermissionOutcome <<choice>>
                ToolPermissionOutcome --> BlockedToolResult : blocked
                ToolPermissionOutcome --> ExecuteToolBatch : allowed
                ExecuteToolBatch --> StreamToolUpdates
                StreamToolUpdates --> AfterToolCallHook
                AfterToolCallHook --> NormalizeResultImages
                NormalizeResultImages --> FinalToolResult
                ErrorToolResult --> PersistToolResult
                BlockedToolResult --> PersistToolResult
                FinalToolResult --> PersistToolResult
                PersistToolResult --> TurnComplete
                ResponseError --> TurnComplete
                TurnComplete --> [*]
            }

            Turn --> NextTurnDecision
            state NextTurnDecision <<choice>>
            NextTurnDecision --> StartTurn : tool results or steering
            NextTurnDecision --> StartTurn : follow-up when otherwise done
            NextTurnDecision --> AgentEnd : no pending work
            AgentEnd --> [*]
        }

        --

        state "Inbound message queues" as QueueInput {
            [*] --> QueueEmpty
            QueueEmpty --> SteeringPending : steer
            QueueEmpty --> FollowUpPending : follow-up
            SteeringPending --> SteeringPending : additional steering
            FollowUpPending --> FollowUpPending : additional follow-up
            SteeringPending --> QueueEmpty : drained after turn
            FollowUpPending --> QueueEmpty : drained after agent would stop
            SteeringPending --> RestoreQueuedText : abort
            FollowUpPending --> RestoreQueuedText : abort
            RestoreQueuedText --> QueueEmpty : return to editor
        }
    }

    Running --> PostRunDecision : agent_end
    state PostRunDecision <<choice>>
    PostRunDecision --> RetryDelay : transient provider error
    PostRunDecision --> Compacting : overflow recovery
    PostRunDecision --> Compacting : threshold reached
    PostRunDecision --> Running : extension queued work at agent_end
    PostRunDecision --> Idle : settled

    RetryDelay --> Running : exponential backoff completed
    RetryDelay --> Idle : retry cancelled or exhausted

    Idle --> Compacting : manual compact

    state "Compaction pipeline" as Compacting {
        [*] --> PrepareCompaction
        PrepareCompaction --> FindCutPoint
        FindCutPoint --> CollectSummaryMessages
        CollectSummaryMessages --> DetectSplitTurn
        DetectSplitTurn --> BeforeCompactHook
        BeforeCompactHook --> CompactionHookOutcome
        state CompactionHookOutcome <<choice>>
        CompactionHookOutcome --> CompactionCancelled : cancel
        CompactionHookOutcome --> UseExtensionSummary : custom summary
        CompactionHookOutcome --> ResolveSummaryAuth : default summary
        ResolveSummaryAuth --> SerializeConversation
        SerializeConversation --> GenerateCompactionSummary
        GenerateCompactionSummary --> SummarizationRetry
        SummarizationRetry --> GenerateCompactionSummary : retry scheduled
        SummarizationRetry --> AppendCompactionEntry : success
        UseExtensionSummary --> AppendCompactionEntry
        AppendCompactionEntry --> RebuildCompactedContext
        RebuildCompactedContext --> EmitCompactionEvents
        EmitCompactionEvents --> [*]
        CompactionCancelled --> [*]
    }

    Compacting --> CompactionOutcome
    state CompactionOutcome <<choice>>
    CompactionOutcome --> Running : compact-and-retry
    CompactionOutcome --> Running : queued work remains
    CompactionOutcome --> Idle : manual or threshold complete
    CompactionOutcome --> Idle : cancelled or failed

    Idle --> TreeNavigation : tree selection

    state "In-place tree navigation" as TreeNavigation {
        [*] --> ValidateTreeTarget
        ValidateTreeTarget --> FindCommonAncestor
        FindCommonAncestor --> CollectAbandonedBranch
        CollectAbandonedBranch --> BeforeTreeHook
        BeforeTreeHook --> TreeOutcome
        state TreeOutcome <<choice>>
        TreeOutcome --> TreeCancelled : cancelled
        TreeOutcome --> GenerateBranchSummary : summarize
        TreeOutcome --> MoveLeaf : no summary
        GenerateBranchSummary --> AppendBranchSummary
        AppendBranchSummary --> ApplyOptionalLabel
        MoveLeaf --> ApplyOptionalLabel
        ApplyOptionalLabel --> RebuildBranchContext
        RebuildBranchContext --> EmitSessionTree
        EmitSessionTree --> [*]
        TreeCancelled --> [*]
    }

    TreeNavigation --> Idle
    Idle --> UserBash : exclamation command
    state "User bash execution" as UserBash
    UserBash --> RecordBashMessage : command completed
    UserBash --> RecordBashMessage : command aborted
    RecordBashMessage --> Idle

    Idle --> Reloading : reload

    state "Reload resources and extensions" as Reloading {
        [*] --> ExtensionShutdownForReload
        ExtensionShutdownForReload --> InvalidateOldContext
        InvalidateOldContext --> ReloadSettings
        ReloadSettings --> ReloadResources
        ReloadResources --> RecreateExtensionRunner
        RecreateExtensionRunner --> RebuildToolsAndPrompt
        RebuildToolsAndPrompt --> ExtensionSessionStart
        ExtensionSessionStart --> DiscoverDynamicResources
        DiscoverDynamicResources --> [*]
    }

    Reloading --> Idle
    Idle --> SessionReplacement : new, resume, fork, clone, or import

    state "Replace active session runtime" as SessionReplacement {
        [*] --> BeforeSessionSwitchHook
        BeforeSessionSwitchHook --> SwitchOutcome
        state SwitchOutcome <<choice>>
        SwitchOutcome --> ReplacementCancelled : cancelled
        SwitchOutcome --> AbortCurrentRun : allowed
        AbortCurrentRun --> PersistOutgoingTurn
        PersistOutgoingTurn --> SessionShutdown
        SessionShutdown --> InvalidateOutgoingContext
        InvalidateOutgoingContext --> DisposeOutgoingSession
        DisposeOutgoingSession --> ResolveTargetCwd
        ResolveTargetCwd --> RecreateCwdServices
        RecreateCwdServices --> CreateReplacementSession
        CreateReplacementSession --> RebindRunMode
        RebindRunMode --> ReplacementSessionStart
        ReplacementSessionStart --> [*]
        ReplacementCancelled --> [*]
    }

    SessionReplacement --> Idle
    Running --> Aborting : escape or abort command
    Compacting --> Aborting : cancel summary
    TreeNavigation --> Aborting : cancel branch summary
    UserBash --> Aborting : cancel process
    Aborting --> Idle : operations settled
    Idle --> Shutdown : quit, EOF, or signal
    Shutdown --> [*]

    classDef active fill:#dbeafe,stroke:#2563eb,color:#172554
    classDef hook fill:#fce7f3,stroke:#db2777,color:#500724
    classDef recovery fill:#ffedd5,stroke:#ea580c,color:#431407
    classDef terminal fill:#f3f4f6,stroke:#4b5563,color:#111827
    class ProviderStreaming,ExecuteToolBatch,GenerateCompactionSummary active
    class EmitInputHook,BeforeAgentStartHook,TransformContextHook,BeforeToolCallHook,AfterToolCallHook,BeforeCompactHook,BeforeTreeHook hook
    class RetryDelay,Compacting,Aborting recovery
    class Idle,Shutdown terminal
`,he=`stateDiagram-v2
    direction TB

    [*] --> RuntimeCreation

    state "Create cwd-bound runtime" as RuntimeCreation {
        [*] --> LoadSettings
        LoadSettings --> ResolveProjectTrust
        ResolveProjectTrust --> DiscoverResources
        DiscoverResources --> LoadExtensions
        LoadExtensions --> RegisterProviders
        RegisterProviders --> RefreshLocalCatalogs
        RefreshLocalCatalogs --> ResolveSessionModel
        ResolveSessionModel --> RestoreThinkingLevel
        RestoreThinkingLevel --> BuildToolRegistry
        BuildToolRegistry --> BuildSystemPrompt
        BuildSystemPrompt --> HydrateSessionContext
        HydrateSessionContext --> BindExtensionCore
        BindExtensionCore --> [*]
    }

    RuntimeCreation --> Idle : session_start
    state "Idle and accepting input" as Idle

    Idle --> PromptPreflight : prompt

    state "Prompt preflight" as PromptPreflight {
        [*] --> CheckExtensionCommand
        CheckExtensionCommand --> CommandOutcome
        state CommandOutcome <<choice>>
        CommandOutcome --> ExecuteCommand : registered command
        CommandOutcome --> EmitInputHook : normal input
        ExecuteCommand --> PreflightHandled
        EmitInputHook --> InputOutcome
        state InputOutcome <<choice>>
        InputOutcome --> PreflightHandled : handled
        InputOutcome --> ExpandPrompt : continue or transform
        ExpandPrompt --> ExpandSkill
        ExpandSkill --> ExpandTemplate
        ExpandTemplate --> StreamingCheck
        StreamingCheck --> QueueBehavior
        state QueueBehavior <<choice>>
        QueueBehavior --> QueueSteering : active and steer
        QueueBehavior --> QueueFollowUp : active and follow-up
        QueueBehavior --> RejectMissingBehavior : active and unspecified
        QueueBehavior --> ValidateModel : inactive
        ValidateModel --> ValidateAuthentication
        ValidateAuthentication --> CheckPreTurnCompaction
        CheckPreTurnCompaction --> BeforeAgentStartHook
        BeforeAgentStartHook --> AssembleInputMessages
        AssembleInputMessages --> PreflightAccepted
        PreflightHandled --> [*]
        QueueSteering --> [*]
        QueueFollowUp --> [*]
        RejectMissingBehavior --> [*]
        PreflightAccepted --> [*]
    }

    PromptPreflight --> Idle : handled, queued, or rejected
    PromptPreflight --> Running : accepted new run

    state "Active agent run" as Running {
        state "Provider and tool loop" as AgentLoop {
            [*] --> AgentStart
            AgentStart --> StartTurn
            StartTurn --> Turn

            state "One assistant turn" as Turn {
                [*] --> RefreshTurnSnapshot
                RefreshTurnSnapshot --> TransformContextHook
                TransformContextHook --> ConvertToLlmMessages
                ConvertToLlmMessages --> FilterBlockedImages
                FilterBlockedImages --> ResolveRequestAuth
                ResolveRequestAuth --> MergeAttributionHeaders
                MergeAttributionHeaders --> BeforeProviderHeadersHook
                BeforeProviderHeadersHook --> BeforeProviderRequestHook
                BeforeProviderRequestHook --> ProviderStreaming
                ProviderStreaming --> AfterProviderResponseHook
                AfterProviderResponseHook --> ResponseOutcome

                state ResponseOutcome <<choice>>
                ResponseOutcome --> ResponseError : error or abort
                ResponseOutcome --> TurnComplete : final response
                ResponseOutcome --> ResolveToolCalls : tool use

                ResolveToolCalls --> ValidateToolArguments
                ValidateToolArguments --> ToolPreparationOutcome
                state ToolPreparationOutcome <<choice>>
                ToolPreparationOutcome --> ErrorToolResult : unknown or invalid
                ToolPreparationOutcome --> BeforeToolCallHook : valid
                BeforeToolCallHook --> ToolPermissionOutcome
                state ToolPermissionOutcome <<choice>>
                ToolPermissionOutcome --> BlockedToolResult : blocked
                ToolPermissionOutcome --> ExecuteToolBatch : allowed
                ExecuteToolBatch --> StreamToolUpdates
                StreamToolUpdates --> AfterToolCallHook
                AfterToolCallHook --> NormalizeResultImages
                NormalizeResultImages --> FinalToolResult
                ErrorToolResult --> PersistToolResult
                BlockedToolResult --> PersistToolResult
                FinalToolResult --> PersistToolResult
                PersistToolResult --> TurnComplete
                ResponseError --> TurnComplete
                TurnComplete --> [*]
            }

            Turn --> NextTurnDecision
            state NextTurnDecision <<choice>>
            NextTurnDecision --> StartTurn : tool results or steering
            NextTurnDecision --> StartTurn : follow-up when otherwise done
            NextTurnDecision --> AgentEnd : no pending work
            AgentEnd --> [*]
        }

        --

        state "Inbound message queues" as QueueInput {
            [*] --> QueueEmpty
            QueueEmpty --> SteeringPending : steer
            QueueEmpty --> FollowUpPending : follow-up
            SteeringPending --> SteeringPending : additional steering
            FollowUpPending --> FollowUpPending : additional follow-up
            SteeringPending --> QueueEmpty : drained after turn
            FollowUpPending --> QueueEmpty : drained after agent would stop
            SteeringPending --> RestoreQueuedText : abort
            FollowUpPending --> RestoreQueuedText : abort
            RestoreQueuedText --> QueueEmpty : return to editor
        }
    }

    Running --> PostRunDecision : agent_end
    state PostRunDecision <<choice>>
    PostRunDecision --> RetryDelay : transient provider error
    PostRunDecision --> Compacting : overflow recovery
    PostRunDecision --> Compacting : threshold reached
    PostRunDecision --> Running : extension queued work at agent_end
    PostRunDecision --> Idle : settled

    RetryDelay --> Running : exponential backoff completed
    RetryDelay --> Idle : retry cancelled or exhausted

    Idle --> Compacting : manual compact

    state "Compaction pipeline" as Compacting {
        [*] --> PrepareCompaction
        PrepareCompaction --> FindCutPoint
        FindCutPoint --> CollectSummaryMessages
        CollectSummaryMessages --> DetectSplitTurn
        DetectSplitTurn --> BeforeCompactHook
        BeforeCompactHook --> CompactionHookOutcome
        state CompactionHookOutcome <<choice>>
        CompactionHookOutcome --> CompactionCancelled : cancel
        CompactionHookOutcome --> UseExtensionSummary : custom summary
        CompactionHookOutcome --> ResolveSummaryAuth : default summary
        ResolveSummaryAuth --> SerializeConversation
        SerializeConversation --> GenerateCompactionSummary
        GenerateCompactionSummary --> SummarizationRetry
        SummarizationRetry --> GenerateCompactionSummary : retry scheduled
        SummarizationRetry --> AppendCompactionEntry : success
        UseExtensionSummary --> AppendCompactionEntry
        AppendCompactionEntry --> RebuildCompactedContext
        RebuildCompactedContext --> EmitCompactionEvents
        EmitCompactionEvents --> [*]
        CompactionCancelled --> [*]
    }

    Compacting --> CompactionOutcome
    state CompactionOutcome <<choice>>
    CompactionOutcome --> Running : compact-and-retry
    CompactionOutcome --> Running : queued work remains
    CompactionOutcome --> Idle : manual or threshold complete
    CompactionOutcome --> Idle : cancelled or failed

    Idle --> TreeNavigation : tree selection

    state "In-place tree navigation" as TreeNavigation {
        [*] --> ValidateTreeTarget
        ValidateTreeTarget --> FindCommonAncestor
        FindCommonAncestor --> CollectAbandonedBranch
        CollectAbandonedBranch --> BeforeTreeHook
        BeforeTreeHook --> TreeOutcome
        state TreeOutcome <<choice>>
        TreeOutcome --> TreeCancelled : cancelled
        TreeOutcome --> GenerateBranchSummary : summarize
        TreeOutcome --> MoveLeaf : no summary
        GenerateBranchSummary --> AppendBranchSummary
        AppendBranchSummary --> ApplyOptionalLabel
        MoveLeaf --> ApplyOptionalLabel
        ApplyOptionalLabel --> RebuildBranchContext
        RebuildBranchContext --> EmitSessionTree
        EmitSessionTree --> [*]
        TreeCancelled --> [*]
    }

    TreeNavigation --> Idle
    Idle --> UserBash : exclamation command
    state "User bash execution" as UserBash
    UserBash --> RecordBashMessage : command completed
    UserBash --> RecordBashMessage : command aborted
    RecordBashMessage --> Idle

    Idle --> Reloading : reload

    state "Reload resources and extensions" as Reloading {
        [*] --> ExtensionShutdownForReload
        ExtensionShutdownForReload --> InvalidateOldContext
        InvalidateOldContext --> ReloadSettings
        ReloadSettings --> ReloadResources
        ReloadResources --> RecreateExtensionRunner
        RecreateExtensionRunner --> RebuildToolsAndPrompt
        RebuildToolsAndPrompt --> ExtensionSessionStart
        ExtensionSessionStart --> DiscoverDynamicResources
        DiscoverDynamicResources --> [*]
    }

    Reloading --> Idle
    Idle --> SessionReplacement : new, resume, fork, clone, or import

    state "Replace active session runtime" as SessionReplacement {
        [*] --> BeforeSessionSwitchHook
        BeforeSessionSwitchHook --> SwitchOutcome
        state SwitchOutcome <<choice>>
        SwitchOutcome --> ReplacementCancelled : cancelled
        SwitchOutcome --> AbortCurrentRun : allowed
        AbortCurrentRun --> PersistOutgoingTurn
        PersistOutgoingTurn --> SessionShutdown
        SessionShutdown --> InvalidateOutgoingContext
        InvalidateOutgoingContext --> DisposeOutgoingSession
        DisposeOutgoingSession --> ResolveTargetCwd
        ResolveTargetCwd --> RecreateCwdServices
        RecreateCwdServices --> CreateReplacementSession
        CreateReplacementSession --> RebindRunMode
        RebindRunMode --> ReplacementSessionStart
        ReplacementSessionStart --> [*]
        ReplacementCancelled --> [*]
    }

    SessionReplacement --> Idle
    Running --> Aborting : escape or abort command
    Compacting --> Aborting : cancel summary
    TreeNavigation --> Aborting : cancel branch summary
    UserBash --> Aborting : cancel process
    Aborting --> Idle : operations settled
    Idle --> Shutdown : quit, EOF, or signal
    Shutdown --> [*]

    classDef active fill:#dbeafe,stroke:#2563eb,color:#172554
    classDef hook fill:#fce7f3,stroke:#db2777,color:#500724
    classDef recovery fill:#ffedd5,stroke:#ea580c,color:#431407
    classDef terminal fill:#f3f4f6,stroke:#4b5563,color:#111827
    class ProviderStreaming,ExecuteToolBatch,GenerateCompactionSummary active
    class EmitInputHook,BeforeAgentStartHook,TransformContextHook,BeforeToolCallHook,AfterToolCallHook,BeforeCompactHook,BeforeTreeHook hook
    class RetryDelay,Compacting,Aborting recovery
    class Idle,Shutdown terminal
`,ge=`flowchart LR
    User([User or host application])

    subgraph Entry["1. Entry points and run modes"]
        direction LR
        CLI["CLI<br/><code>main.ts</code><br/>arguments, files, stdin"]
        SDK["Node.js SDK<br/><code>createAgentSession()</code><br/><code>createAgentSessionRuntime()</code>"]
        TUI["Interactive mode<br/><code>InteractiveMode</code><br/>pi-tui editor and chat"]
        Print["Print / JSON mode<br/><code>runPrintMode()</code><br/>text or JSONL events"]
        RPC["RPC mode<br/><code>runRpcMode()</code><br/>JSONL commands, responses, events"]
        RPCClient["External RPC client<br/>any language or process"]
    end

    User --> CLI
    User --> SDK
    CLI --> TUI
    CLI --> Print
    CLI --> RPC
    RPCClient <-->|"LF-delimited JSON"| RPC

    subgraph Bootstrap["2. CLI bootstrap and cwd-bound service composition"]
        direction TB
        Parse["Parse CLI options<br/>resolve mode, files, model, tools"]
        Trust["Resolve project trust<br/>saved decision, override, extension hook, or prompt"]
        ServiceFactory["<code>createAgentSessionServices()</code><br/>recreated when session cwd changes"]
        Settings["<code>SettingsManager</code><br/>merge global and trusted project settings"]
        Resources["<code>DefaultResourceLoader</code><br/>discover and load resources"]
        Models["<code>ModelRuntime</code><br/>providers, catalogs, auth, availability"]
        Sessions["<code>SessionManager</code><br/>new, continue, resume, fork, or memory"]
        SessionFactory["<code>createAgentSessionFromServices()</code><br/>resolve model, thinking level, and tools"]
    end

    CLI --> Parse --> Trust --> ServiceFactory
    ServiceFactory --> Settings
    ServiceFactory --> Resources
    ServiceFactory --> Models
    Parse --> Sessions
    Settings --> SessionFactory
    Resources --> SessionFactory
    Models --> SessionFactory
    Sessions --> SessionFactory
    SDK -->|"may construct the same services directly"| SessionFactory

    subgraph Runtime["3. Replaceable session runtime"]
        direction TB
        RuntimeHost["<code>AgentSessionRuntime</code><br/>owns current session and cwd-bound services"]
        Replace["Session replacement<br/>new, resume, fork, clone, import"]
        Session["<code>AgentSession</code><br/>shared orchestration for every mode"]
        ExtRunner["<code>ExtensionRunner</code><br/>hooks, commands, tools, providers, UI"]
        ToolRegistry["Tool registry<br/>active allowlist and prompt guidance"]
        SystemPrompt["System prompt builder<br/>base prompt + tools + skills + context"]
    end

    SessionFactory --> RuntimeHost
    RuntimeHost --> Session
    Replace -->|"shutdown old runtime"| RuntimeHost
    RuntimeHost -->|"recreate for target cwd"| Replace
    TUI <-->|"commands and session events"| RuntimeHost
    Print <-->|"prompts and session events"| RuntimeHost
    RPC <-->|"commands and session events"| RuntimeHost
    SDK <-->|"direct typed API and events"| Session
    Resources --> ExtRunner
    Session <--> ExtRunner
    Session --> ToolRegistry
    Session --> SystemPrompt
    Resources --> SystemPrompt
    ToolRegistry --> SystemPrompt

    subgraph AgentCore["4. Provider-agnostic agent core"]
        direction TB
        Agent["<code>Agent</code><br/>state, lifecycle, abort, steering and follow-up queues"]
        Loop["<code>runAgentLoop()</code><br/>assistant turn and tool loop"]
        Context["Context boundary<br/>extension transform, image filtering,<br/>convert AgentMessage to LLM Message"]
        Stream["Streaming model call<br/>text, thinking, tool-call, usage deltas"]
        Validate["Resolve tool and validate arguments"]
        Execute["Execute tool calls<br/>parallel by default, sequential when required"]
        Continue{"More tool calls,<br/>steering, or follow-up?"}
    end

    Session -->|"prompt or continue"| Agent
    Agent --> Loop
    Loop --> Context
    Context --> Models
    Models --> Stream
    Stream -->|"assistant tool calls"| Validate
    Validate --> Execute
    Execute -->|"tool-result messages"| Continue
    Continue -->|"yes: next turn"| Context
    Continue -->|"no: agent_end"| Agent
    Stream -->|"final response or error"| Agent

    subgraph Providers["5. Model and provider layer"]
        direction LR
        PiAI["pi-ai<br/>provider adapters and normalized streams"]
        BuiltinProviders["Built-in providers<br/>Anthropic, OpenAI, Google,<br/>Bedrock, OpenRouter, and others"]
        CustomProviders["Custom providers<br/><code>models.json</code> or extensions"]
        APIs[(Remote model APIs<br/>or local llama.cpp router)]
    end

    Models --> PiAI
    ExtRunner -->|"register or unregister"| Models
    PiAI --> BuiltinProviders
    PiAI --> CustomProviders
    BuiltinProviders <--> APIs
    CustomProviders <--> APIs
    APIs -->|"normalized event stream"| Stream

    subgraph Tools["6. Tool execution boundary"]
        direction LR
        BuiltinTools["Built-in tools<br/>read, bash, edit, write,<br/>grep, find, ls"]
        ExtensionTools["Extension and SDK tools<br/>custom schemas and renderers"]
        Files[(Project files)]
        Shell[(Shell and child processes)]
    end

    BuiltinTools --> ToolRegistry
    ExtensionTools --> ToolRegistry
    ExtRunner --> ExtensionTools
    ToolRegistry --> Validate
    Execute --> BuiltinTools
    Execute --> ExtensionTools
    BuiltinTools --> Files
    BuiltinTools --> Shell

    subgraph Persistence["7. State, configuration, and discovered resources"]
        direction LR
        SessionFiles[("Session JSONL<br/>tree entries with id and parentId")]
        SettingsFiles[("settings.json<br/>global plus trusted project")]
        AuthFiles[("auth.json and model catalogs")]
        ResourceFiles[("AGENTS.md / CLAUDE.md<br/>SYSTEM.md<br/>extensions, skills, prompts, themes<br/>pi packages")]
    end

    Sessions <--> SessionFiles
    Session -->|"persist message, model, thinking,<br/>compaction, branch, labels, custom state"| Sessions
    Settings <--> SettingsFiles
    Models <--> AuthFiles
    Resources <--> ResourceFiles

    subgraph Reliability["8. Session-level reliability and context control"]
        direction LR
        Retry["Automatic retry<br/>transient provider failures<br/>with exponential backoff"]
        Compact["Compaction<br/>threshold, overflow recovery, or manual"]
        Branch["Tree navigation<br/>optional abandoned-branch summary"]
        SummaryCall["One-off summarization call"]
    end

    Session --> Retry
    Retry -->|"continue without persisted error in active context"| Agent
    Session --> Compact
    Session --> Branch
    Compact --> SummaryCall
    Branch --> SummaryCall
    SummaryCall --> Models
    Compact -->|"append summary checkpoint and rebuild context"| Sessions
    Branch -->|"move leaf; optionally append summary"| Sessions

    ExtRunner -.->|"input, before_agent_start,<br/>context and provider hooks"| Context
    ExtRunner -.->|"tool_call may block"| Validate
    ExtRunner -.->|"tool_result may transform"| Execute
    Agent -.->|"ordered lifecycle events"| Session
    Session -.->|"events for rendering or transport"| TUI
    Session -.->|"events"| Print
    Session -.->|"events"| RPC

    classDef interface fill:#dbeafe,stroke:#2563eb,color:#172554
    classDef core fill:#ede9fe,stroke:#7c3aed,color:#2e1065
    classDef service fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef external fill:#ffedd5,stroke:#ea580c,color:#431407
    classDef data fill:#f3f4f6,stroke:#4b5563,color:#111827
    classDef hook fill:#fce7f3,stroke:#db2777,color:#500724

    class CLI,SDK,TUI,Print,RPC,RPCClient interface
    class RuntimeHost,Session,Agent,Loop,Context,Stream,Validate,Execute,Continue core
    class Parse,Trust,ServiceFactory,SessionFactory,Settings,Resources,Models,Sessions,SystemPrompt,ToolRegistry service
    class PiAI,BuiltinProviders,CustomProviders,APIs,Files,Shell external
    class SessionFiles,SettingsFiles,AuthFiles,ResourceFiles data
    class ExtRunner,Retry,Compact,Branch,SummaryCall hook
`,_e=`flowchart TB
    User([User or host application])

    subgraph Entry["1. Entry points and run modes"]
        direction LR
        CLI["CLI<br/><code>main.ts</code><br/>arguments, files, stdin"]
        SDK["Node.js SDK<br/><code>createAgentSession()</code><br/><code>createAgentSessionRuntime()</code>"]
        TUI["Interactive mode<br/><code>InteractiveMode</code><br/>pi-tui editor and chat"]
        Print["Print / JSON mode<br/><code>runPrintMode()</code><br/>text or JSONL events"]
        RPC["RPC mode<br/><code>runRpcMode()</code><br/>JSONL commands, responses, events"]
        RPCClient["External RPC client<br/>any language or process"]
    end

    User --> CLI
    User --> SDK
    CLI --> TUI
    CLI --> Print
    CLI --> RPC
    RPCClient <-->|"LF-delimited JSON"| RPC

    subgraph Bootstrap["2. CLI bootstrap and cwd-bound service composition"]
        direction TB
        Parse["Parse CLI options<br/>resolve mode, files, model, tools"]
        Trust["Resolve project trust<br/>saved decision, override, extension hook, or prompt"]
        ServiceFactory["<code>createAgentSessionServices()</code><br/>recreated when session cwd changes"]
        Settings["<code>SettingsManager</code><br/>merge global and trusted project settings"]
        Resources["<code>DefaultResourceLoader</code><br/>discover and load resources"]
        Models["<code>ModelRuntime</code><br/>providers, catalogs, auth, availability"]
        Sessions["<code>SessionManager</code><br/>new, continue, resume, fork, or memory"]
        SessionFactory["<code>createAgentSessionFromServices()</code><br/>resolve model, thinking level, and tools"]
    end

    CLI --> Parse --> Trust --> ServiceFactory
    ServiceFactory --> Settings
    ServiceFactory --> Resources
    ServiceFactory --> Models
    Parse --> Sessions
    Settings --> SessionFactory
    Resources --> SessionFactory
    Models --> SessionFactory
    Sessions --> SessionFactory
    SDK -->|"may construct the same services directly"| SessionFactory

    subgraph Runtime["3. Replaceable session runtime"]
        direction TB
        RuntimeHost["<code>AgentSessionRuntime</code><br/>owns current session and cwd-bound services"]
        Replace["Session replacement<br/>new, resume, fork, clone, import"]
        Session["<code>AgentSession</code><br/>shared orchestration for every mode"]
        ExtRunner["<code>ExtensionRunner</code><br/>hooks, commands, tools, providers, UI"]
        ToolRegistry["Tool registry<br/>active allowlist and prompt guidance"]
        SystemPrompt["System prompt builder<br/>base prompt + tools + skills + context"]
    end

    SessionFactory --> RuntimeHost
    RuntimeHost --> Session
    Replace -->|"shutdown old runtime"| RuntimeHost
    RuntimeHost -->|"recreate for target cwd"| Replace
    TUI <-->|"commands and session events"| RuntimeHost
    Print <-->|"prompts and session events"| RuntimeHost
    RPC <-->|"commands and session events"| RuntimeHost
    SDK <-->|"direct typed API and events"| Session
    Resources --> ExtRunner
    Session <--> ExtRunner
    Session --> ToolRegistry
    Session --> SystemPrompt
    Resources --> SystemPrompt
    ToolRegistry --> SystemPrompt

    subgraph AgentCore["4. Provider-agnostic agent core"]
        direction TB
        Agent["<code>Agent</code><br/>state, lifecycle, abort, steering and follow-up queues"]
        Loop["<code>runAgentLoop()</code><br/>assistant turn and tool loop"]
        Context["Context boundary<br/>extension transform, image filtering,<br/>convert AgentMessage to LLM Message"]
        Stream["Streaming model call<br/>text, thinking, tool-call, usage deltas"]
        Validate["Resolve tool and validate arguments"]
        Execute["Execute tool calls<br/>parallel by default, sequential when required"]
        Continue{"More tool calls,<br/>steering, or follow-up?"}
    end

    Session -->|"prompt or continue"| Agent
    Agent --> Loop
    Loop --> Context
    Context --> Models
    Models --> Stream
    Stream -->|"assistant tool calls"| Validate
    Validate --> Execute
    Execute -->|"tool-result messages"| Continue
    Continue -->|"yes: next turn"| Context
    Continue -->|"no: agent_end"| Agent
    Stream -->|"final response or error"| Agent

    subgraph Providers["5. Model and provider layer"]
        direction LR
        PiAI["pi-ai<br/>provider adapters and normalized streams"]
        BuiltinProviders["Built-in providers<br/>Anthropic, OpenAI, Google,<br/>Bedrock, OpenRouter, and others"]
        CustomProviders["Custom providers<br/><code>models.json</code> or extensions"]
        APIs[(Remote model APIs<br/>or local llama.cpp router)]
    end

    Models --> PiAI
    ExtRunner -->|"register or unregister"| Models
    PiAI --> BuiltinProviders
    PiAI --> CustomProviders
    BuiltinProviders <--> APIs
    CustomProviders <--> APIs
    APIs -->|"normalized event stream"| Stream

    subgraph Tools["6. Tool execution boundary"]
        direction LR
        BuiltinTools["Built-in tools<br/>read, bash, edit, write,<br/>grep, find, ls"]
        ExtensionTools["Extension and SDK tools<br/>custom schemas and renderers"]
        Files[(Project files)]
        Shell[(Shell and child processes)]
    end

    BuiltinTools --> ToolRegistry
    ExtensionTools --> ToolRegistry
    ExtRunner --> ExtensionTools
    ToolRegistry --> Validate
    Execute --> BuiltinTools
    Execute --> ExtensionTools
    BuiltinTools --> Files
    BuiltinTools --> Shell

    subgraph Persistence["7. State, configuration, and discovered resources"]
        direction LR
        SessionFiles[("Session JSONL<br/>tree entries with id and parentId")]
        SettingsFiles[("settings.json<br/>global plus trusted project")]
        AuthFiles[("auth.json and model catalogs")]
        ResourceFiles[("AGENTS.md / CLAUDE.md<br/>SYSTEM.md<br/>extensions, skills, prompts, themes<br/>pi packages")]
    end

    Sessions <--> SessionFiles
    Session -->|"persist message, model, thinking,<br/>compaction, branch, labels, custom state"| Sessions
    Settings <--> SettingsFiles
    Models <--> AuthFiles
    Resources <--> ResourceFiles

    subgraph Reliability["8. Session-level reliability and context control"]
        direction LR
        Retry["Automatic retry<br/>transient provider failures<br/>with exponential backoff"]
        Compact["Compaction<br/>threshold, overflow recovery, or manual"]
        Branch["Tree navigation<br/>optional abandoned-branch summary"]
        SummaryCall["One-off summarization call"]
    end

    Session --> Retry
    Retry -->|"continue without persisted error in active context"| Agent
    Session --> Compact
    Session --> Branch
    Compact --> SummaryCall
    Branch --> SummaryCall
    SummaryCall --> Models
    Compact -->|"append summary checkpoint and rebuild context"| Sessions
    Branch -->|"move leaf; optionally append summary"| Sessions

    ExtRunner -.->|"input, before_agent_start,<br/>context and provider hooks"| Context
    ExtRunner -.->|"tool_call may block"| Validate
    ExtRunner -.->|"tool_result may transform"| Execute
    Agent -.->|"ordered lifecycle events"| Session
    Session -.->|"events for rendering or transport"| TUI
    Session -.->|"events"| Print
    Session -.->|"events"| RPC

    classDef interface fill:#dbeafe,stroke:#2563eb,color:#172554
    classDef core fill:#ede9fe,stroke:#7c3aed,color:#2e1065
    classDef service fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef external fill:#ffedd5,stroke:#ea580c,color:#431407
    classDef data fill:#f3f4f6,stroke:#4b5563,color:#111827
    classDef hook fill:#fce7f3,stroke:#db2777,color:#500724

    class CLI,SDK,TUI,Print,RPC,RPCClient interface
    class RuntimeHost,Session,Agent,Loop,Context,Stream,Validate,Execute,Continue core
    class Parse,Trust,ServiceFactory,SessionFactory,Settings,Resources,Models,Sessions,SystemPrompt,ToolRegistry service
    class PiAI,BuiltinProviders,CustomProviders,APIs,Files,Shell external
    class SessionFiles,SettingsFiles,AuthFiles,ResourceFiles data
    class ExtRunner,Retry,Compact,Branch,SummaryCall hook
`,ve=`sequenceDiagram
    autonumber
    actor U as User / host
    participant M as Run mode
    participant S as AgentSession
    participant X as ExtensionRunner
    participant A as Agent and agent loop
    participant R as ModelRuntime / pi-ai
    participant P as Model provider
    participant T as Tool
    participant J as SessionManager

    U->>M: Submit prompt
    M->>S: prompt(text, images, queue behavior)
    S->>X: input
    X-->>S: continue, transform, or handled
    S->>S: Dispatch extension command or expand skill/template

    alt Agent is already streaming
        S->>A: Queue steering or follow-up message
        S-->>M: queue_update
    else New run
        S->>S: Validate model/auth and check pre-turn compaction
        S->>X: before_agent_start
        X-->>S: optional custom messages and system-prompt override
        S->>A: prompt(user and custom messages)
        A-->>S: agent_start, turn_start, message events
        S->>J: Append completed input messages

        loop Until no tool calls or queued messages remain
            A->>X: context
            X-->>A: transformed AgentMessage context
            A->>A: Convert to provider-compatible messages
            A->>R: stream(model, prompt, tools, transport)
            R->>X: before_provider_headers / before_provider_request
            R->>P: Provider request
            P-->>R: Streaming text, thinking, tool calls, usage
            R->>X: after_provider_response
            R-->>A: Normalized stream events
            A-->>S: message_start / update / end
            S->>X: Mirrored lifecycle events
            S->>J: Append final assistant message
            S-->>M: Render or serialize events

            opt Assistant requested tools
                A->>A: Resolve tool and validate schema
                A->>X: tool_call
                X-->>A: allow or block
                A->>T: execute(args, signal, onUpdate)
                T-->>A: result, updates, usage, terminate flag
                A->>X: tool_result
                X-->>A: optional transformed result
                A-->>S: tool execution and message events
                S->>J: Append tool-result message
            end

            A->>A: Drain steering after turn and follow-up when otherwise done
        end

        A-->>S: agent_end
        S->>S: Retry transient errors or compact overflow if needed
        opt Retry or compact-and-retry
            S->>A: continue()
        end
        S->>X: agent_settled
        S-->>M: agent_settled
        M-->>U: Final rendered, text, JSONL, RPC, or SDK result
    end
`,ye=`%% regression: a cycle fully inside a subgraph crashes elkjs's
%% MODEL_ORDER / GREEDY_MODEL_ORDER cycle breakers under INCLUDE_CHILDREN
graph TD
  subgraph S[Retry loop]
    B[attempt] --> C[failed?]
    C --> B
  end
  A[start] --> B
  C --> D[give up]
`,be=`flowchart LR
  subgraph P[Pipeline]
    direction TB
    parse --> check --> emit
  end
  subgraph W[Workers]
    w1 --> w2
  end
  in[source] --> P
  emit --> W
  w2 --> out[artifact]
`,xe=`stateDiagram-v2
  direction LR
  [*] --> Boot
  Boot --> Auth: config loaded
  Auth --> Session: token ok
  Auth --> Locked: 3 failures
  Locked --> Auth: timeout
  state Session {
    direction LR
    [*] --> Idle
    Idle --> Streaming: request
    Streaming --> Idle: complete
    Streaming --> Aborted: cancel
    Aborted --> Idle
    --
    [*] --> Cold
    Cold --> Warm: cache fill
    Warm --> Cold: evict
  }
  Session --> Draining: shutdown
  state fork <<choice>>
  Draining --> fork
  fork --> Flushed: buffers empty
  fork --> Killed: timeout
  Flushed --> [*]
  Killed --> [*]
`,Se=`stateDiagram-v2
  [*] --> Boot
  Boot --> Auth: config loaded
  Auth --> Session: token ok
  Auth --> Locked: 3 failures
  Locked --> Auth: timeout
  state Session {
    direction LR
    [*] --> Idle
    Idle --> Streaming: request
    Streaming --> Idle: complete
    Streaming --> Aborted: cancel
    Aborted --> Idle
    --
    [*] --> Cold
    Cold --> Warm: cache fill
    Warm --> Cold: evict
  }
  Session --> Draining: shutdown
  state fork <<choice>>
  Draining --> fork
  fork --> Flushed: buffers empty
  fork --> Killed: timeout
  Flushed --> [*]
  Killed --> [*]
`,j=[`forEach`,`isDisjointFrom`,`isSubsetOf`,`isSupersetOf`],M=[`difference`,`intersection`,`symmetricDifference`,`union`],N=!1,Ce=class t extends Set{#e=new Map;#t=D(0);#n=D(0);#r=o||-1;constructor(e){if(super(),e){for(var t of e)super.add(t);this.#n.v=super.size}N||this.#a()}#i(e){return o===this.#r?D(e):k(e)}#a(){N=!0;var e=t.prototype,n=Set.prototype;for(let t of j)e[t]=function(...e){return p(this.#t),n[t].apply(this,e)};for(let r of M)e[r]=function(...e){p(this.#t);var i=n[r].apply(this,e);return new t(i)}}has(e){var t=super.has(e),n=this.#e,r=n.get(e);if(r===void 0){if(!t)return p(this.#t),!1;r=this.#i(!0),n.set(e,r)}return p(r),t}add(t){return super.has(t)||(super.add(t),S(this.#n,super.size),e(this.#t)),this}delete(t){var n=super.delete(t),r=this.#e,i=r.get(t);return i!==void 0&&(r.delete(t),S(i,!1)),n&&(S(this.#n,super.size),e(this.#t)),n}clear(){if(super.size!==0){super.clear();var t=this.#e;for(var n of t.values())S(n,!1);t.clear(),S(this.#n,0),e(this.#t)}}keys(){return this.values()}values(){return p(this.#t),super.values()}entries(){return p(this.#t),super.entries()}[Symbol.iterator](){return this.keys()}get size(){return p(this.#n)}},we=u(`<label class="dim svelte-1s1pej0">labels <input type="checkbox"/></label> <label class="dim svelte-1s1pej0" title="streaming mode: one cheap pass, may exceed the fit width">fast <input type="checkbox"/></label> <label class="dim fit svelte-1s1pej0">fit <input type="number" min="20" placeholder="off" class="svelte-1s1pej0"/></label>`,1),Te=u(`<div class="menu svelte-1s1pej0" role="dialog" aria-label="engine layout options" tabindex="-1"><div class="menu-title svelte-1s1pej0">engine options</div> <!> <button class="ghost elk-reset svelte-1s1pej0">[reset]</button></div>`),Ee=u(`<option> </option>`),De=u(`<label class="elk-opt svelte-1s1pej0"><span class="dim svelte-1s1pej0"> </span> <select class="svelte-1s1pej0"></select></label>`),Oe=u(`<div class="menu svelte-1s1pej0" role="dialog" aria-label="ELK layout options" tabindex="-1"><div class="menu-title svelte-1s1pej0">elk options</div> <!> <button class="ghost elk-reset svelte-1s1pej0">[reset]</button></div>`),ke=u(`<pre class="src svelte-1s1pej0" tabindex="0"> </pre>`),Ae=u(`<section class="card svelte-1s1pej0"><h2 class="svelte-1s1pej0"> <button>[src]</button></h2> <div><!> <!></div></section>`),je=u(`<div class="gallery svelte-1s1pej0"><div class="bar svelte-1s1pej0"><span class="accent svelte-1s1pej0">lovely-mermaid</span> <span class="dim svelte-1s1pej0">examples</span> <a class="ghost svelte-1s1pej0">[learn]</a> <span class="spacer svelte-1s1pej0"></span> <button>[engine]</button> <button>[legacy]</button> <button>[mermaid]</button> <button>[elk]</button> <!> <button>[opts]</button> <button class="ghost svelte-1s1pej0"> </button></div> <!> <!> <div class="cards svelte-1s1pej0"></div></div>`);function P(e,i){ee(i,!0);let o=Object.entries(Object.assign({"../../../../examples/arch-classes.mmd":de,"../../../../examples/arch-session-er-lr.mmd":fe,"../../../../examples/arch-session-er.mmd":pe,"../../../../examples/arch-state-lr.mmd":me,"../../../../examples/arch-state.mmd":he,"../../../../examples/arch-system-lr.mmd":ge,"../../../../examples/arch-system.mmd":_e,"../../../../examples/arch-tool-loop.mmd":ve,"../../../../examples/cluster-cycle.mmd":ye,"../../../../examples/flow-lr-directions.mmd":be,"../../../../examples/state-regions-lr.mmd":xe,"../../../../examples/state-regions.mmd":Se})).map(([e,t])=>({name:e.split(`/`).pop().replace(/\.mmd$/,``),src:t})).sort((e,t)=>e.name.localeCompare(t.name)),u=D(`engine`),k=D(!0),j=D(f({})),M=D(!1),N=D(null),P=D(!1),F=D(!1);{let e=location.hash.slice(1);e===``?S(F,!0):se(e).then(e=>{let t=JSON.parse(e);t.renderer!==void 0&&S(u,t.renderer,!0),t.elkOn!==void 0&&S(k,t.elkOn,!0),t.elkExtra!==void 0&&S(V,t.elkExtra,!0),t.engineOpts!==void 0&&S(j,t.engineOpts,!0),t.fitWidth!==void 0&&S(N,t.fitWidth,!0),t.fast!==void 0&&S(P,t.fast,!0),t.showLabels!==void 0&&S(z,t.showLabels,!0),t.dark!==void 0&&S(B,t.dark,!0)}).catch(()=>{}).finally(()=>S(F,!0))}let I=0;a(()=>{let e=JSON.stringify({renderer:p(u),elkOn:p(k),elkExtra:p(V),engineOpts:p(j),fitWidth:p(N),fast:p(P),showLabels:p(z),dark:p(B)});if(!p(F))return;let t=++I,n=setTimeout(()=>{ce(e).then(e=>{t===I&&history.replaceState(null,``,`${A}/examples#${e}`)})},300);return()=>clearTimeout(n)});let L;function R(e){clearTimeout(L),S(N,e===``?null:Number(e),!0)}let z=D(!0),B=D(!0);a(()=>{document.body.classList.toggle(`light`,!p(B))});let Me=O(()=>oe[p(B)?`dark`:`light`]),Ne=[{key:`elk.layered.nodePlacement.strategy`,label:`placement`,values:[`BRANDES_KOEPF`,`LINEAR_SEGMENTS`,`NETWORK_SIMPLEX`,`SIMPLE`]},{key:`elk.layered.layering.strategy`,label:`layering`,values:[`NETWORK_SIMPLEX`,`LONGEST_PATH`,`COFFMAN_GRAHAM`,`MIN_WIDTH`]},{key:`elk.layered.cycleBreaking.strategy`,label:`cycle breaking`,values:[`DEPTH_FIRST`,`GREEDY`,`GREEDY_MODEL_ORDER`,`MODEL_ORDER`]},{key:`elk.layered.compaction.postCompaction.strategy`,label:`compaction`,values:[`NONE`,`LEFT`,`RIGHT`,`EDGE_LENGTH`]},{key:`elk.layered.considerModelOrder.strategy`,label:`model order`,values:[`NONE`,`NODES_AND_EDGES`,`PREFER_NODES`,`PREFER_EDGES`]},{key:`elk.layered.mergeEdges`,label:`merge edges`,values:[`false`,`true`]},{key:`elk.layered.feedbackEdges`,label:`feedback edges`,values:[`false`,`true`]}],V=D(f({})),H=D(!1),U=new Ce;var W=je();m(`1s1pej0`,e=>{h(()=>{re.title=`lovely-mermaid — examples`})}),l(`keydown`,c,e=>{e.key===`Escape`&&(S(H,!1),S(M,!1))});var G=v(W),Pe=y(v(G),4),K=y(Pe,4);let Fe;var q=y(K,2);let Ie;var J=y(q,2);let Le;var Y=y(J,2);let X;var Re=y(Y,2),ze=e=>{var n=we(),r=_(n),i=y(v(r));C(i),E(r);var a=y(r,2),o=y(v(a));C(o),E(a);var c=y(a,2),l=y(v(c));C(l),E(c),g(()=>te(l,p(N)??``)),T(i,()=>p(z),e=>S(z,e)),T(o,()=>p(P),e=>S(P,e)),s(`input`,l,e=>{let t=e.currentTarget.value;clearTimeout(L),L=setTimeout(()=>R(t),500)}),s(`change`,l,e=>R(e.currentTarget.value)),t(e,n)};d(Re,e=>{p(u)===`engine`&&e(ze)});var Z=y(Re,2);let Be;var Q=y(Z,2),Ve=v(Q);E(Q),E(G);var He=y(G,2),Ue=e=>{var n=Te(),r=y(v(n),2);le(r,{get value(){return p(j)},set value(e){S(j,e,!0)}});var i=y(r,2);E(n),g(e=>i.disabled=e,[()=>Object.keys(p(j)).length===0]),s(`click`,i,()=>S(j,{},!0)),t(e,n)};d(He,e=>{p(M)&&p(u)===`engine`&&e(Ue)});var We=y(He,2),Ge=e=>{var i=Oe(),a=y(v(i),2);r(a,17,()=>Ne,n,(e,i)=>{var a=De(),o=v(a),c=v(o,!0);E(o);var l=y(o,2);r(l,21,()=>p(i).values,n,(e,n)=>{var r=Ee(),i=v(r,!0);E(r);var a={};g(e=>{w(i,e),a!==(a=p(n))&&(r.value=(r.__value=p(n))??``)},[()=>p(n).toLowerCase()]),t(e,r)}),E(l);var u;b(l),E(a),g(()=>{w(c,p(i).label),u!==(u=p(V)[p(i).key]??p(i).values[0])&&(l.value=(l.__value=p(V)[p(i).key]??p(i).values[0])??``,ae(l,p(V)[p(i).key]??p(i).values[0]))}),s(`change`,l,e=>{let t=e.currentTarget.value;t===p(i).values[0]?delete p(V)[p(i).key]:p(V)[p(i).key]=t}),t(e,a)});var o=y(a,2);E(i),g(e=>o.disabled=e,[()=>Object.keys(p(V)).length===0]),s(`click`,o,()=>S(V,{},!0)),t(e,i)};d(We,e=>{p(H)&&p(u)===`lovely`&&e(Ge)});var $=y(We,2);r($,21,()=>o,e=>e.name,(e,n)=>{var r=Ae(),i=v(r),a=v(i),o=y(a);let c;E(i);var l=y(i,2);let f;var m=v(l);ue(m,{get src(){return p(n).src},get renderer(){return p(u)},get elkOn(){return p(k)},get elkExtra(){return p(V)},get engineOpts(){return p(j)},get fitWidth(){return p(N)},get fast(){return p(P)},get showLabels(){return p(z)},get dark(){return p(B)},get theme(){return p(Me)}});var h=y(m,2),_=e=>{var r=ke(),i=v(r,!0);E(r),g(()=>w(i,p(n).src)),s(`keydown`,r,e=>{if((e.ctrlKey||e.metaKey)&&e.key===`a`){e.preventDefault();let t=getSelection(),n=document.createRange();n.selectNodeContents(e.currentTarget),t?.removeAllRanges(),t?.addRange(n)}}),t(e,r)},b=O(()=>U.has(p(n).name));d(h,e=>{p(b)&&e(_)}),E(l),E(r),g((e,t)=>{w(a,`${p(n).name??``} `),c=x(o,1,`ghost svelte-1s1pej0`,null,c,e),f=x(l,1,`frame svelte-1s1pej0`,null,f,t)},[()=>({active:U.has(p(n).name)}),()=>({split:U.has(p(n).name)})]),s(`click`,o,()=>{U.delete(p(n).name)||U.add(p(n).name)}),t(e,r)}),E($),E(W),g(()=>{ne(Pe,`href`,`${A??``}/learn`),Fe=x(K,1,`ghost svelte-1s1pej0`,null,Fe,{active:p(u)===`engine`}),Ie=x(q,1,`ghost svelte-1s1pej0`,null,Ie,{active:p(u)===`lovely`}),Le=x(J,1,`ghost svelte-1s1pej0`,null,Le,{active:p(u)===`mermaid`}),X=x(Y,1,`ghost svelte-1s1pej0`,null,X,{active:p(k)}),Y.disabled=p(u)!==`lovely`,Be=x(Z,1,`ghost svelte-1s1pej0`,null,Be,{active:p(M)||p(H)}),Z.disabled=p(u)===`mermaid`||p(u)===`lovely`&&!p(k),w(Ve,`[${p(B)?`light`:`dark`}]`)}),s(`click`,K,()=>S(u,`engine`)),s(`click`,q,()=>S(u,`lovely`)),s(`click`,J,()=>S(u,`mermaid`)),s(`click`,Y,()=>S(k,!p(k))),s(`click`,Z,()=>{p(u)===`engine`?S(M,!p(M)):S(H,!p(H))}),s(`click`,Q,()=>S(B,!p(B))),t(e,W),ie()}i([`click`,`input`,`change`,`keydown`]);export{P as component};