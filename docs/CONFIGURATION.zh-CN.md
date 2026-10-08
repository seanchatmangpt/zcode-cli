# 配置说明

[English](CONFIGURATION.md) | 简体中文

CLI 跟随当前 ZCode runtime 的 provider registry schema。通用运行设置与 provider 配置
分别存储；模型配置中的“智能配置”对应英文界面的 **Smart configuration**。

## 配置文件

| 文件 | 用途 |
| --- | --- |
| `~/.zcode/cli/setting.json` | CLI 主题、通知、工具、存储和其他运行设置 |
| `~/.zcode/v2/setting.json` | 桌面端已有的语言和记忆偏好，CLI 只读不修改 |
| `~/.zcode/v2/provider_config.json` | Provider、模型元数据覆盖和默认模型 |
| `~/.zcode/v2/credentials.json` | 原生 runtime 持久化的凭证 |

Windows 使用 `%USERPROFILE%` 代替 `~`。Provider 文件默认与桌面端共用，修改 provider
或已保存的默认模型会影响两个客户端；`/model` 只切换当前 CLI 会话。

设置 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 可使用独立的 provider 文件。
`ZCODE_DATA_BASE_DIR` 改变原生 runtime 的基础目录，包括 provider 和凭证存储。
CLI 通用设置仍使用用户目录中的 `~/.zcode/cli/setting.json`。

首次启动时，CLI 根据不含凭证的 [`setting.example.json`](../setting.example.json)
创建通用设置，不覆盖已有文件。Provider 配置由原生登录创建，或参考
[`provider.example.json`](../provider.example.json) 填写。
[Provider 配置字段参考](PROVIDER_CONFIG.zh-CN.md) 列出了全部个人配置字段、桌面端字段对应关系
及上游目录继承规则。

## 启动迁移

CLI 参考桌面端迁移规则，使用 runtime 的原生解析器和带文件锁的 provider 仓库。
桌面端在首次创建原生文件时导入旧 provider；由于共享文件可能已经存在，CLI 启动时会额外
执行一次从 `~/.zcode/cli/config.json` 到共享文件的合并。

只添加缺失的个人 provider ID，保留已有 provider 定义、模型覆盖、排序和共享默认选择。
账号 provider 和加密密钥不参与导入；已删除的模型也不导入。模型 ID 与 provider 别名
由上游解析器规范化，不支持的 provider 配置会记为跳过。

CLI 专属字段迁移到 `~/.zcode/cli/setting.json`，省略 provider、main/lite 和目录覆盖字段。
旧文件保留原样。`~/.zcode/cli/migrations/` 中按目标 provider 文件记录完成标记，防止后续
启动恢复用户已删除的 provider。独立的 `settings-v1.json` 标记防止重置新设置文件后
再次导入旧设置。

旧文件不作为运行时配置 fallback。新文件无效时会报告错误，不会用旧设置替换它。

## 设置归属与优先级

| 设置或操作 | 读写行为 |
| --- | --- |
| Provider 和模型元数据 | 共享的原生 `provider_config.json` |
| `/settings` 中的默认模型 | 写入共享默认选择，并应用到当前会话 |
| `/model`、模型循环切换、推理强度 | 修改并保存当前会话选择，不改共享默认值 |
| `/new` | 读取当前共享默认模型 |
| 恢复会话／重启 | 恢复该会话保存的模型和推理选项 |
| 语言与记忆 | 读取桌面端 `localePreference`／`memoryEnabled`，显式 CLI 设置优先 |
| 主题、终端布局、选中复制、通知 | CLI `setting.json` |
| 工具权限、重试、流超时、CLI 插件／MCP 等运行设置 | CLI `setting.json`，保留原生项目和环境配置优先级 |
| 更新缓存、诊断日志、迁移状态 | CLI 目录下的运行文件 |

CLI 不向桌面端的 `setting.json` 增加字段。通知和显示设置只写 CLI 文件。
共享偏好在加载 runtime 设置时生效，不会因修改其他 CLI 选项而被复制进 CLI 设置。

## 模型目录与默认选择

原生 registry 加载随包提供的目录，并管理上游目录刷新。`/model`、模型循环切换以及
**设置 > Model providers** 会从配置源刷新当前 registry，保留当前会话。
CLI 不再维护独立的旧版模型目录缓存。

Provider 文件中的 `config.defaultModelSelection` 决定新会话使用的模型。
`/settings` 通过原生仓库保存该选择并应用到当前会话；`/model provider/model` 只切换
当前会话。恢复的会话可以继续使用它自己保存的选择。

保存的选择未指定推理选项时，runtime 使用该模型的目录默认值补齐。
已经明确选择的推理强度会保留。

## 首次设置

第一次交互启动会显示设置向导，可选择 **Sign in**、**Custom provider** 或 **Skip for now**。
使用 `/setup` 可以重新打开。通用配置旁的 `setup-pending` 标记在非交互命令后仍会保留，
成功配置或明确跳过后才会清除。已有原生 provider 配置会被直接识别，无需单独导入桌面端配置。

## 模型访问

- **macOS 上的 Z.AI OAuth：** 使用 `zcode login`；`zcode login --oauth` 强制重新授权。
  `--no-browser` 只输出授权链接。
- **Z.AI／BigModel Coding Plan API Key：** 打开 `/login`，选择掩码输入的 API Key 选项。
  凭证和 provider 的保存由官方 runtime 负责。
- **自定义 provider：** 直接配置原生 provider 文件，可使用自定义 ID，无需额外 OAuth 登录。

普通的 `zcode login` 会识别已经配置的原生默认模型并提示配置路径。
本地仅检查配置是否存在，凭证校验与解密由 runtime 负责。

macOS OAuth 会临时注册回调接收器、校验 `state`，恢复原来的 `zcode://` 处理程序，并通过
stdin 把回调交给 runtime。Runtime 交换令牌、保存加密凭证、解析 Coding Plan API Key，
再保存原生默认模型；TUI 随后重新读取 provider 配置。BigModel 使用 runtime 的 localhost 回调。

## 自定义 Provider

`provider.example.json` 中启用的模型自动继承上游目录，禁用的参考模型分别展示智能覆盖和
手动配置的全部字段。填写空 API Key、替换占位 ID 和地址，并删除不需要的参考条目。
已有文件应合并修改，保留其他规则和选择。

最小配置结构如下：

```json
{
  "schemaVersion": 1,
  "config": {
    "providerConfigRules": {
      "providerRules": [
        {
          "providerId": "custom",
          "providerName": "Custom provider",
          "config": {
            "group": "standard-personal",
            "access": { "type": "api-key", "apiKey": "YOUR_API_KEY" },
            "api": {
              "type": "openai-chat-completions",
              "baseUrl": "https://api.example.com/v1"
            },
            "personalModelIds": ["your-model-id"]
          }
        }
      ]
    },
    "modelConfigRules": {
      "providerModelRules": [],
      "manualProviderModelRules": []
    },
    "defaultModelSelection": {
      "providerId": "custom",
      "modelId": "your-model-id"
    }
  }
}
```

Anthropic 兼容接口使用 `anthropic-messages`，Chat Completions 使用
`openai-chat-completions`，Responses API 使用 `openai-responses`。
`baseUrl` 是 API 根地址；模型 ID 区分大小写，引用格式为 `providerId/modelId`。

```text
/model custom/your-model-id
/settings
/new
```

原生目录提供已知模型的上下文、推理选项及输入输出能力。自定义覆盖写在
`modelConfigRules` 下，包括 `properties.contextWindow`、`properties.inputFormat`
和 `optionSpecs`。图片、视频及 PDF 支持以所选模型的 registry 元数据为准。

桌面端三个能力开关分别对应 `properties.supportsJsonSchemaOutput`、
`supportsNativeWebSearch`、`supportsMidConversationSystem`。最大输出 Token 是
`optionSpecs.maxOutputTokens.max`，与上下文容量不同；请求参数映射写在对应选项的
`map` 字符串中。完整说明见 [Provider 字段参考](PROVIDER_CONFIG.zh-CN.md)。

ZCode 桌面端应用保存在 `<storage.dir>/v2/agents-state.json` 中的内置子代理模型覆盖使用
桌面端 provider ID：3.12.3 在 `builtInModelSelectionOverrides` 下保存完整选择（例如
`{"providerId": "account:zai-individual-coding-plan", "modelId": "GLM-5.3"}`），
更早的文件使用 `builtInModelOverrides` 字符串，如
`custom:builtin%3Azai-coding-plan:GLM-5.3-Flash`。CLI 从不注册这些 provider ID，
因此 runtime 补丁会把 `builtin:zai-coding-plan` 以及 `account:zai-*-coding-plan` /
`-start-plan` 形状解析到键为 `zai` 的 provider（`bigmodel` 等价形状解析到
`bigmodel`）。要更改这些子代理使用的模型，请在桌面端应用中修改覆盖；
`defaultModelSelection` 对它们不生效。

上游目录更新后，智能配置模型会自动继承新的能力与参数规格；只有显式个人覆盖保持固定。
同步 runtime 会复制完整目录，`/model` 会刷新实时 registry，不必把上游能力值逐个写进个人文件。

## 权限模式与计划状态

CLI 与桌面端一样提供三种权限模式：`build`（变更前确认）、`edit`（自动编辑）、
`yolo`（完全访问）。`/mode` 打开选择器，Shift+Tab 在三种模式间循环。
底层的 `auto` 值不作为菜单选项。

`/plan` 独立切换计划开关，也可以用 `/plan on`、`/plan off` 明确指定状态。
切换权限不会改变 Plan 开关，切换 Plan 也不会改变权限。验证由原生 runtime 负责，
包括 Plan 与进行中的 Goal 不可同时开启的限制。

Plan 开启时，在输入框上边框右端显示 `Plan`，不增加行数；空编辑器会显示规划提示。
状态栏始终显示权限模式，`/status` 分别列出 Mode 和 Plan。
标签跟随原生状态变化，包括批准计划、新会话及恢复会话，不额外写入 CLI Plan 偏好。

## 执行 Provider registry

`~/.zcode/v2/execution_provider_config.json`（`schemaVersion` 为 1）选择用于 XaaS
work-order 分派的执行 provider。文件包含 `executionProviderRules`——一组带 `providerId`
和 `enabled` 字段的规则——以及可选的 `defaultExecutionSelection`，用于指定默认 provider。
选择是 fail-closed 的：文件不可读或格式错误时拒绝选择（`registry_invalid`）；默认 provider
被禁用或未知时，回退到下一条启用的规则，或以类型化错误拒绝（`provider_disabled`、
`provider_unknown`）。不存在 registry 文件时，使用内置的 `zcode` provider。
`ZCODE_EXECUTION_PROVIDER_CONFIG_FILE` 可覆盖该路径。

## 发送前的访问检查

新的无界面提示和普通 TUI 输入会在开始模型请求前，检查明显缺少 provider 配置或
显式缺少 API Key 的情况。检查不会输出密钥、凭证，也不会通过网络验证它们。
账号鉴权、格式错误的配置、环境覆盖、项目配置以及恢复的无界面会话，仍由 runtime 处理。

TUI 会把被拒绝的输入放回空编辑器，或保留在后续输入队列中，不覆盖新草稿。
无界面命令会退出并输出配置说明。登录、设置和其他管理命令仍可使用。

### 后台 Agent

运行超过一秒的 Agent 调用默认转入后台，通过 `/tasks` 继续访问；短任务保留在当前轮次，
便于直接使用结果。阈值单位为毫秒：

```json
{
  "subagents": {
    "autoBackgroundMs": 1000
  }
}
```

设为 `0` 可禁用自动后台化。工具调用中显式设置 `run_in_background: true` 时会立即进入后台。

### Expert 工作流策略

内置 `/expert` 工作流的受限策略（clarify 轮数、executor 并发、critic 迭代、react-loop
轮数）在上游硬编码。`expert-strategy-config` runtime 补丁会把 `~/.zcode/cli/setting.json`
中 `expertWorkflow.strategy` 键的覆盖项深合并到上游默认值之上；配置只在进程启动时读取
一次，修改后需重启生效。未知键会被忽略，每个叶子只接受有限正数——格式错误的值会静默
保留上游默认值，因此坏配置永远不会使工作流定义失效：

```json
{
  "expertWorkflow": {
    "strategy": {
      "clarify": { "confidenceThreshold": 0.6, "maxRounds": 5 },
      "executor": {
        "drainingChangeHours": 2,
        "frontierTarget": 8,
        "maxConcurrentLoops": 6,
        "maxConsecutiveErrors": 6,
        "maxPlannerRuns": 40
      },
      "finalCritic": { "maxIterations": 5 },
      "reactLoop": { "maxRounds": 200 }
    }
  }
}
```

上游默认值：clarify `confidenceThreshold 0.8, maxRounds 3, minRounds 1`；executor
`drainingChangeHours 1, frontierTarget 3, maxConcurrentLoops 2, maxConsecutiveErrors 3,
maxPlannerRuns 10`；finalCritic `maxIterations 3`；reactLoop `maxRounds 30`。取值必须是
正整数（`confidenceThreshold` 和 `drainingChangeHours` 可为小数）；合并结果由 runtime
自身的 schema 校验。注意 `/workflow` 运行以及外部分派（xaas/headless）的 zcode 进程
不使用 expert 策略。

### 请求重试和流中断

重试分类和执行由官方 runtime 负责。CLI 提供默认五次重试预算，可使用原生环境变量覆盖：

```bash
ZCODE_MODEL_RETRY_MAX_RETRIES=3 zcode
```

新建配置使用 60 秒的模型流空闲超时：

```json
{
  "modelStream": {
    "idleTimeoutMs": 60000
  }
}
```

已有配置不会被覆盖；如果旧文件仍为 `600000`，需要手动修改。可重试的超时、断流、
限流、服务端和网络错误会重试并在 TUI 中显示。鉴权失败和无效请求不重试。

## Runtime 诊断日志

交互 TUI 会捕获 runtime 的 `stderr`，防止后台日志破坏终端显示。Runtime 非零退出时，
TUI 结束后会输出退出状态和日志路径。日志限制为 2 MB，下次启动时轮转为 `.1`，
两个文件均使用仅当前用户可读写的权限。

默认路径为 `~/.zcode/cli/tui-runtime.log`，也可指定独立路径：

```bash
ZCODE_TUI_RUNTIME_LOG=/tmp/zcode-tui-runtime.log zcode
```

## TUI 显示模式

默认使用普通终端回滚模式。将 `ui.tuiMode` 设为 `"fullscreen"` 可使用替代屏幕、
独立滚动的会话记录、固定输入区和鼠标滚轮／滚动条导航。浏览旧消息时输入区仍然可用。
内容放得下时隐藏滚动条；滚动时短暂显示，并跟随明暗主题。

```json
{
  "ui": {
    "tuiMode": "fullscreen"
  }
}
```

也可以在 `/settings` 或 `/config` 的 **Display mode** 中修改。
`ZCODE_TUI_MODE=fullscreen` 和 `ZCODE_TUI_MODE=regular` 临时覆盖保存值，设置页会提示该覆盖，
不会删除环境变量。

正常退出或处理 `SIGINT`、`SIGTERM`、`SIGHUP` 时会恢复终端状态。
任何终端程序都无法拦截强制的 `SIGKILL`。

### 选中自动复制

全屏模式中，释放鼠标选择会把文本复制到系统剪贴板。将 `ui.copyOnSelect` 设为 `false`
可只高亮、不自动复制；终端原生选择仍可通过按住 Shift 或终端指定的修饰键使用。
此选项只影响全屏模式，普通回滚模式不启用鼠标选择。
设置页中的 **Fullscreen copy on select** 提供同一开关。

```json
{
  "ui": {
    "copyOnSelect": false
  }
}
```

## 主题

在 CLI `setting.json` 中将 `ui.theme` 设为 `"auto"`、`"dark"` 或 `"light"`。
macOS／Linux 路径为 `~/.zcode/cli/setting.json`，Windows 为
`%USERPROFILE%\.zcode\cli\setting.json`。明确指定的明暗主题优先于终端探测。
`auto` 在启动时查询终端背景和配色模式，并应用匹配的调色板。

## 轮次完成通知

默认在终端失去焦点时，为普通 Agent 轮次的完成或失败发送通知。
自动选择终端能力的策略与 Codex 一致：`auto` 在 Ghostty、iTerm2、Kitty、Warp 和 WezTerm
中使用 OSC 9，在 Apple Terminal 等终端中使用 BEL。显式选择 OSC 9 而终端不支持时也改用 BEL，
避免发送被忽略的序列。

`unfocused` 条件使用终端的 DEC 焦点报告。在尚未确认焦点支持时，会发送通知，
不会一直当作“已聚焦”而抑制通知。`native` 需要明确启用，并使用已有系统工具：
macOS 的 `terminal-notifier`、Linux 的 `notify-send` 或 Windows 的 `SnoreToast`。
项目不捆绑这些工具；命令不可用或发送失败时使用 BEL。

macOS 会将检测到的终端 App 用作发送者和点击目标。能否恢复精确的标签页或窗格取决于终端；
默认 `auto` 可以保留支持 OSC 的终端原生行为。

在 TUI 中打开设置：

```text
/config
/settings
```

两个命令等效。保存一项后返回设置首页，便于连续修改；Esc 先返回首页，再关闭设置。
修改立即应用到当前会话，并持久化到 CLI `setting.json` 的 `ui.notifications`：

```json
{
  "ui": {
    "notifications": {
      "method": "auto",
      "condition": "unfocused"
    }
  }
}
```

环境变量在启动时覆盖文件值，适合当前 shell 的临时设置：

```bash
export ZCODE_TUI_NOTIFICATION_METHOD=auto       # auto|osc9|bel|native|off
export ZCODE_TUI_NOTIFICATION_CONDITION=always  # unfocused|always
zcode
```

## 官方 MCP 可用性

如果捆绑 runtime 没有官方 MCP 的可信来源 registry，官方 HTTP MCP 服务会显示为禁用，
诊断码为 `official_auth_unavailable`。插件的其他组件仍然可用。
这不会关闭证书、来源或权限校验；runtime 提供所需 registry 时也不会抑制服务。

## 注册本地或开发中的 MCP 服务器或插件

本仓库的其他文档都没有说明如何把本地或开发中的 MCP 服务器（或插件）接入 ZCode。
本节记录两条受支持的路径，均在本会话中针对 ZCode 3.11.2-25 通过逆向捆绑 runtime
（`vendor/zcode.cjs`）并在 TUI 中实际验证过。

### 直接注册 MCP 服务器

最快的路径——并且按照下文的已知限制，也是目前唯一对需要真实密钥的服务器有效的
路径——是在 `config.json` 的 `mcp.servers` 键下直接注册服务器。整个过程不涉及插件、
市场或信任系统：

```json
{
  "mcp": {
    "servers": {
      "my-server-name": {
        "type": "http",
        "url": "http://localhost:PORT/path",
        "headers": { "Authorization": "Bearer <token>" }
      }
    }
  }
}
```

配置加载器会从全局配置（`~/.zcode/cli/config.json`，见上文"配置文件"）或项目级配置
文件中读取该键——项目级文件是 `zcode.json` 或 `.zcode/config.json`，从当前工作目录
向上查找到最近的 `.git` 祖先为止。这与 provider 和模型设置已有的项目级覆盖机制相同
（见上文"自定义 Provider"）；`mcp.servers` 条目在这两个层级中用法一致。

本会话已端到端验证：按上述方式添加条目后，服务器会出现在 TUI 的 `/mcp` 面板中，
显示为 `connected · http · N tools`，并且启动（或重启）`zcode` 后，可以在实际任务中
按名称真正调用。

### 无界面会话注册：项目级 `.mcp.json`

自本目录树的 runtime 重建（2026-09-21）起，**无界面（headless）**会话——
`zcode --prompt "..."` 运行以及 XaaS 的 `node bin/zcode.js gall-work --lease <n>`
等自动化入口——会从工作目录中的项目级 `.mcp.json` 文件注册 MCP 服务器。交互式会话
不读取该文件；它们从用户级设置解析 `mcp.servers`（同一次重建后为
`~/.zcode/cli/setting.json`——上文"直接注册 MCP 服务器"记录的是重建前 `config.json`
中的位置，早于本次变更）。这种不对称对租约 worker 流程至关重要：worker 会话在
consumer 仓库中运行，没有打开的交互式会话，因此像 xaas-fabric 的 `xaas-execution`
MCP 服务器这样的集成必须注册在仓库的 `.mcp.json` 中，而不是只写在操作者的
用户级设置里。

Schema——已安装的 xaas-fabric 插件缓存中带的正是这个文件：

```json
{
  "mcpServers": {
    "xaas-execution": {
      "type": "http",
      "url": "http://localhost:4000/internal-api/execution/mcp",
      "headers": {
        "Authorization": "Bearer ${user_config.zcode_xaas_token}"
      }
    }
  }
}
```

`${user_config.*}` 占位符在加载时从用户配置插值。这个位置不支持普通的
`${ENV_VAR}` 占位符；相关的 preflight 行为见下文的插件安装限制。

凭证规则：项目 `.mcp.json` 携带 Bearer token，因此它是机器本地的，绝不能进入版本
控制。本仓库在 `.gitignore` 中同时列出了 `.mcp.json` 和 `setting.json`；任何收到该
文件的 consumer 仓库也需要相同的两条目。

### 插件市场安装路径

ZCode 还支持安装打包在插件内的 MCP 服务器，通过本地市场：

```bash
zcode plugins marketplace add <local-dir-with-marketplace.json> --yes --json
zcode plugins install <plugin-name>@<marketplace-name> --yes --json
```

两个文件所需的确切格式由 `test/runtime/launcher.test.ts` 的 "adds a local
marketplace and installs its Plugin end to end" 测试（约 267-336 行）端到端验证；
权威且当前通过的示例请直接阅读该测试。其 `marketplace.json`：

```json
{
  "name": "cli-smoke-marketplace",
  "pluginRoot": ".",
  "plugins": [
    {
      "description": "CLI smoke plugin",
      "name": "cli-smoke-plugin",
      "source": "./plugin",
      "version": "1.0.0"
    }
  ]
}
```

以及插件自己的 `.zcode-plugin/plugin.json`，位于 `plugins[].source` 相对 `pluginRoot`
指定的路径：

```json
{
  "description": "CLI smoke plugin",
  "name": "cli-smoke-plugin",
  "skills": "skills",
  "version": "1.0.0"
}
```

`skills` 指定一个目录（相对插件根目录），其中每个技能一个子目录，各自包含自己的
`SKILL.md`。插件自己的 `.mcp.json`（其捆绑的 MCP 服务器定义）也放在同一个
`.zcode-plugin/` 布局中。

#### 已知限制：`.mcp.json` 使用普通环境变量时安装失败

本会话确认：`zcode plugins install` 会失败并输出

```json
{
  "code": "plugin_variable_missing",
  "message": "Missing environment variable: <VAR>",
  "severity": "error"
}
```

只要插件的 `.mcp.json` 引用了普通的、非 `user_config.*` 占位符——
`${ENV_VAR_NAME}`——即使该变量确实已在进程环境中设置，即使是无需 `allowSensitive`
的 `ZCODE_` 前缀名称也会失败。通过阅读捆绑 runtime 找到的根因：插件诊断 preflight
（此构建中的函数 `Y4o`）为该检查硬编码了空对象（`env: {}`）作为替换上下文，
与真实进程环境无关。这是 vendored runtime 中已确认的 bug，不是插件作者的
`.mcp.json` 写错了。

**实际影响：** 在此 ZCode 构建（3.11.2-25）上，任何 `.mcp.json` 需要 bearer token
或其他秘密环境变量的插件，目前都无法通过 `zcode plugins install` 安装。在 runtime
修复之前，请改用上文的直接 `mcp.servers` 注册路径——它没有这样的 preflight，
今天就可以用于需要真实密钥的服务器。

### 参见

- 上文"官方 MCP 可用性"——官方 HTTP MCP 服务独立的
  `official_auth_unavailable` 诊断，与本节记录的本地/开发路径无关。
- [宿主集成契约](./HOST_INTEGRATION.md)——宿主用于启动 `zcode` 的
  进程/stdio 边界；它不涉及插件或 MCP 注册。
- `test/runtime/launcher.test.ts`——上文本地市场加插件安装格式的权威、
  当前通过的来源。

## 回合上限（--max-turns）

`zcode --max-turns N ...`（或环境变量 `ZCODE_MAX_TURNS=N`，该变量同样会传给
`zcode app-server`）限制每个回合的模型调用步数。达到 N 时，回合以 `error_max_turns`
（"Reached maximum number of turns (N)."）失败。启动器会把该标志转换为对应的环境变量；
sync-runtime 的 max-turns 补丁在 `runRegularTurnLoop` 内读取
`config.maxTurns ?? ZCODE_MAX_TURNS`。
实测驱动脚本：`node scripts/max-turns-live.mjs <N> <out.jsonl>`。
该处理不会改写用户配置。

## 子代理回合上限（subagents.maxTurns）

子代理（Agent 工具）会话默认上限为 **4** 回合。`~/.zcode/cli/setting.json`
中的 `subagents.maxTurns` 可提高该上限：启动器将其转换为环境变量
`ZCODE_SUBAGENT_MAX_TURNS`，sync-runtime 的 subagent-max-turns 补丁在
spawn 站点读取该变量。优先级：显式 `ZCODE_SUBAGENT_MAX_TURNS` 环境变量 >
`subagents.maxTurns` > 上游默认值 4。仅正整数生效；顶层 `--max-turns`
上限不适用于子代理（子代理的回合上限在 spawn 时设置）。更改需重新启动
进程生效——运行中的会话沿用自己的环境变量。
