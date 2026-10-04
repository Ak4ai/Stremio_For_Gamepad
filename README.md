# 🎮 Stremio For Gamepad

<p align="center">
  <img src="src/assets/hero.png" alt="Stremio For Gamepad" width="720" style="border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);" />
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
1. Execute `Stremio_For_Gamepad.exe`.
2. O aplicativo abre em tela cheia e sobe o servidor de streaming automaticamente.

### 2. Instalador Oficial do Windows (NSIS / MSI)
1. Execute `Stremio For Gamepad_0.1.0_x64-setup.exe`.
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
