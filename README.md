# 🎮 Steam for Consoles

<p align="center">
  <img src="src/assets/hero.png" alt="Steam for Consoles" width="720" style="border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);" />
</p>

<p align="center">
  <strong>Uma interface moderna de console (10-foot UI) para Stremio, projetada do zero para Gamepads, TV, PC e Steam Deck.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2.0-24C8D8?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Steam_Deck-Verified-171A21?style=for-the-badge&logo=steam&logoColor=white" alt="Steam Deck" />
  <img src="https://img.shields.io/badge/Windows-10%2F11-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" />
</p>

---

## ✨ Recursos Principais

### 🖥️ Tela Cheia Nativa por Padrão
- Inicia automaticamente ocupando 100% da sua TV ou monitor sem bordas.
- Opção dedicada na tela de **Configurações** para alternar entre **Tela Cheia** ou **Modo Janela**.
- Atalho global <kbd>F11</kbd> para comutar a qualquer momento com notificação Toast visual.

### 🎮 Suporte Abrangente a Controles & Glifos Reativos
- **Detecção Automática e Manual**:
  - 🕹️ **Steam Deck (Valve)** — Glifos autênticos em vetor SVG (`A`, `B`, `X`, `Y`, `LB`, `RB`, `LT`, `RT`, `View`, `Menu`).
  - 🎮 **Xbox** — Padrão oficial (`A`, `B`, `X`, `Y`, bumpers e gatilhos).
  - 🎮 **PlayStation / DualSense** — (`✕`, `◯`, `▢`, `△`, `L1`, `R1`, `L2`, `R2`) com suporte a touchpad e LED RGB dinâmico.
  - 🕹️ **Nintendo Switch** — Pro Controller e Joy-Cons.
  - ⌨️ **Teclado / PC** — Navegação completa por setas, Enter, Esc, Q/E, 1/2 e teclas de atalho.
- **Menu do Sistema Rápido**: Pressione <kbd>Start</kbd> (ou <kbd>Options</kbd>, <kbd>+</kbd>, <kbd>Menu</kbd> ou <kbd>M</kbd>) na tela principal para abrir um modal integrado ao tema ativo com opções de **Minimizar**, acessar o **Repositório GitHub** ou **Sair** do aplicativo.

### 🫧 Liquid Glass Studio Optics
- Shader físico translúcido inspirado em vidro líquido.
- Refração Snell real via SVG `feDisplacementMap`, dispersão cromática prismática na borda (âmbar, pico de brilho branco e azul/ciano) e reflexos dinâmicos a -45°, eliminando qualquer borda ou costura plástica.

### 🎨 5 Temas Visuais Exclusivos
1. **Liquid Glass**: Estética translúcida premium com refração orgânica contínua.
2. **PlayStation 1 (32-Bit)**: Nostalgia dos anos 90 com cinza industrial, cores dos botões clássicos e iluminação ciano do LED DualSense.
3. **OLED Puro**: Fundo 100% preto profundo `#000000` para contraste infinito e economia em telas OLED.
4. **SteamOS**: Interface inspirada no deck com tons grafite e azul Steam.
5. **Stremio Oficial**: Roxo clássico característico do ecossistema Stremio.

### 🇧🇷 Áudio & Dublagem PT-BR
- Filtro opcional nas configurações que prioriza automaticamente streams com **[DUBLADO]**, **[DUAL]**, **[PT-BR]**, **MultiDub** e bandeira 🇧🇷.
- Alternância rápida com um botão no controle durante a seleção de episódios ou fontes.

### ☁️ Sincronização em Nuvem & Streaming Engine
- Login direto na conta oficial do Stremio com carregamento da **Biblioteca**, **Continuar Assistindo** e **Addons instalados**.
- **Servidor Local Embutido**: Inicializa silenciosamente o motor de streaming do Stremio na porta `11470` em segundo plano com ffmpeg e ffprobe.

---

## 🚀 Como Executar

### 1. Versão Portátil (Sem Instalação)
Baixe o executável na aba de [Releases](../../releases) ou copie da pasta `release/`:
1. Execute `Steam_for_Consoles.exe`.
2. O aplicativo abre em tela cheia e sobe o servidor de streaming automaticamente.

### 2. Instalador Oficial do Windows (NSIS / MSI)
1. Execute `Steam for Consoles_0.1.0_x64-setup.exe`.
2. O assistente criará atalhos na Área de Trabalho e no Menu Iniciar.

---

## 🛠️ Compilação e Desenvolvimento Local

### Pré-requisitos
- [Node.js](https://nodejs.org/) (versão 20 ou superior)
- [Rust](https://rustup.rs/) (versão 1.80+)
- Compilador C++ (MSYS2 MinGW-w64 GCC ou Visual Studio C++ Build Tools)

### Instalação das dependências
```bash
npm install
```

### Executar em modo desenvolvimento (HMR)
```bash
npm run dev
```

### Compilar o executável nativo (.exe)
```bash
# Compilar frontend e empacotar via Tauri com MinGW GCC:
scripts\build-tauri.bat

# Ou diretamente via npm:
npm run tauri:build
```
Os arquivos finais serão gerados automaticamente na pasta `release/` e `src-tauri/target/release/`.

---

## 🤖 CI/CD com GitHub Actions

O repositório inclui automação completa via [GitHub Actions](.github/workflows/release.yml):
- Ao criar e publicar uma tag (`git tag v0.1.0 && git push origin v0.1.0`), o workflow do GitHub Actions compila o binário no Windows, gera o instalador NSIS e o pacote MSI, publicando automaticamente uma **Release Oficial** com os arquivos `.exe` para download direto.
- Também pode ser acionado manualmente pela aba **Actions** no GitHub.

---

## 📄 Licença
Distribuído sob a licença MIT. Consulte `LICENSE` para mais informações.

## Steam Overlay (Windows)

Adicione `release/Steam_for_Consoles.exe` como jogo não Steam e inicie pela Biblioteca. Nas propriedades do atalho, habilite o overlay da Steam e confira o destino e o nome **Steam for Consoles**. O navegador e o modo de desenvolvimento não oferecem esta integração.

A versão atual preserva a identidade do atalho e não inicializa o SDK de teste nem usa o AppID 480 (Spacewar). Executáveis e instaladores antigos continuam com o comportamento da versão em que foram compilados; recompilar com `scripts\build-tauri.bat` atualiza a versão portátil em `release/`.

O WebView2 renderiza em outro processo. Para o overlay, uma superfície Direct3D 12 no processo principal é criada apenas em lançamentos pela Steam. Ela prepara a conexão com 20 quadros ocultos e depois pausa a apresentação até Shift+Tab. Uma captura do aplicativo serve como fundo do overlay, permanecendo congelada enquanto ele está aberto. A reprodução continua na janela principal. Ao fechar o overlay ou falhar a ativação, a superfície é ocultada.

Shift+Tab é encaminhado ao processo nativo antes da navegação da busca. Pedidos simultâneos são agrupados para evitar abrir/fechar duas vezes. O retorno do foco bloqueia a repetição imediata do atalho.

Os logs nativos ficam em `%LOCALAPPDATA%/com.stremio.gamepad/logs/`. A linha de inicialização informa se o renderer foi injetado e os IDs recebidos da Steam. O identificador de armazenamento foi preservado para manter as configurações anteriores.

`npm run tauri:build` também sincroniza o executável portátil de `release/`. Feche o aplicativo antes de compilar; se a cópia falhar, o build avisa em vez de informar sucesso com o executável antigo. Ao sair, somente o motor iniciado pelo próprio aplicativo é encerrado, permitindo que a Steam libere o atalho para outra execução.

Teste de teclado: `npm run test:steam`. Testes de transição: `cargo test --manifest-path src-tauri/Cargo.toml --lib`. A validação visual do overlay exige iniciar o executável pela Steam.
