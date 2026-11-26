# dsh-paste-image

[![CI](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml/badge.svg)](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-paste-image.svg)](https://www.npmjs.com/package/dsh-paste-image)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

[简体中文](docs/DETAIL.zh.md) · [English](docs/DETAIL.en.md) · [Español](docs/DETAIL.es.md) · [Français](docs/DETAIL.fr.md) · [Deutsch](docs/DETAIL.de.md) · [Русский](docs/DETAIL.ru.md) · [Português](docs/DETAIL.pt.md)

Cole ou arraste quase qualquer imagem para o DeepSeek Harness — mesmo quando a área de transferência diz `image/xpm` ou mente sobre o tipo MIME.

## Por que este plugin existe

O cliente desktop do DSH (Electron/Chromium) aceita exatamente quatro tipos de anexo: `image/png`, `image/jpeg`, `image/webp` e `image/gif`. Qualquer outro é rejeitado com um erro em vermelho que lista apenas PNG, JPG, WebP e GIF.

Essa lista branca quebra duas coisas que acontecem o tempo todo no Linux:

- **Capturas de tela declaradas como XPM.** Algumas ferramentas de captura de tela, principalmente no Ubuntu/Wayland, colocam a imagem na área de transferência com o tipo `image/xpm`. Os pixels estão corretos; o rótulo é que não está na lista branca, então a colagem é rejeitada.
- **Bytes BMP vestindo rótulo de PNG.** Alguns aplicativos entregam um payload BMP (ou TIFF) declarando `image/png`. O tipo declarado passa na verificação da lista branca, o decodificador falha depois, e você recebe o mesmo erro em vermelho.

O `dsh-paste-image` resolve os dois casos dentro do renderer: ele olha os bytes reais, decodifica o que a área de transferência realmente contém, recodifica no formato de saída escolhido (WebP por padrão) e devolve o resultado ao canal normal de anexos.

## Como funciona

1. **Captura.** `install()` registra listeners de `paste` e `drop` em `document` na fase de captura, para que o plugin veja o evento antes do composer.
2. **Detecção.** `handle()` lê os objetos `File` de `clipboardData` ou `dataTransfer`, e `sniff()` identifica o formato real pelos magic bytes — não pelo tipo MIME declarado.
3. **Recodificação.** `normalize()` deixa os arquivos nativos passarem intactos. Todo o resto é decodificado (caminhos dedicados para XPM, BMP/DIB e SVG, o codec do próprio navegador para o restante), desenhado em um canvas limitado a 4096 px no lado mais longo e exportado no formato de saída escolhido (WebP por padrão); a extensão segue o MIME real (`.png`/`.jpg`/`.webp`).
4. **Redirecionamento.** `handle()` dispara um evento `drop` sintético carregando o novo `File` em `[data-composer-card]`, que é o mesmo caminho percorrido por um arrastar-e-soltar real. Um marcador `__dshPasteImageRerouted` impede que o plugin intercepte o próprio evento.

Tudo isso roda no cliente. Não existe processo host, não há polling da área de transferência e nenhuma requisição de rede é feita.

## Formatos suportados

Esta tabela é a versão curta. A [referência de suporte a formatos](docs/en/formats.md) explica o pipeline de decisão, a grade completa de variantes de BMP e o que está intencionalmente fora de escopo.

| Formato                       | Tipo declarado típico | O que acontece                                                                                                                                     |
| ----------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| PNG                           | `image/png`           | Passa intacto                                                                                                                                      |
| JPEG / JFIF                   | `image/jpeg`          | Passa intacto                                                                                                                                      |
| WebP                          | `image/webp`          | Passa intacto                                                                                                                                      |
| GIF                           | `image/gif`           | Passa intacto                                                                                                                                      |
| XPM (texto XPM3)              | `image/xpm`           | Decodificado por `decodeXpm()`, recodificado no formato de saída escolhido (WebP por padrão)                                                       |
| BMP / DIB                     | `image/bmp`           | Decodificação pelo navegador primeiro, fallback em `decodeBmp()`: 1/4/8/16/24/32 bits, RLE4/RLE8, BITFIELDS, cabeçalhos OS/2 e DIBs sem cabeçalho  |
| SVG                           | `image/svg+xml`       | Rasterizado por meio de um elemento `<img>`, recodificado no formato de saída escolhido (WebP por padrão)                                          |
| ICO / CUR                     | `image/x-icon`        | Decodificação pelo navegador primeiro, depois fallback para a maior entrada comprimida em PNG                                                      |
| TIFF                          | `image/tiff`          | Detectado pelos magic bytes; decodificado apenas se o navegador tiver um codec TIFF (o Chromium não tem); caso contrário, o original passa intacto |
| AVIF                          | `image/avif`          | Decodificado pelo Chromium, recodificado no formato de saída escolhido (WebP por padrão)                                                           |
| HEIC / HEIF, outros `image/*` | `image/...`           | Detectado pelos magic bytes; decodificado apenas quando o navegador tem o codec (o Chromium não decodifica HEIC); caso contrário, passa intacto    |

O repasse intacto só acontece quando os magic bytes correspondem a um dos quatro tipos nativos **e** o tipo declarado concorda. Um arquivo cujos bytes são JPEG mas que declara `image/png` é recodificado no formato de saída escolhido (WebP por padrão), então o tipo declarado não consegue mais mentir. Um arquivo nativo sem nenhum tipo declarado é reembrulhado com o tipo detectado em vez de ser recodificado, e grafias alternativas comuns (`image/jpg`, `image/x-png`, `image/x-bmp`, `image/x-xpixmap`, `image/svg+xml`, …) contam como concordância.

Um arquivo é considerado quando seu tipo MIME começa com `image/` ou seu nome termina em `.png`, `.jpg`, `.jpeg`, `.jfif`, `.gif`, `.webp`, `.bmp`, `.dib`, `.tif`, `.tiff`, `.xpm`, `.avif`, `.ico`, `.cur`, `.svg`, `.heic` ou `.heif`. Arquivos que não são imagem na mesma colagem são encaminhados intactos.

## Instalação

```bash
dsh plugin --profile <profile> add dsh-paste-image
```

O pacote é distribuído pré-compilado — bundle do renderer, entrada do host, patch do loader, metadados de exibição e documentação — então a instalação o baixa direto do registry do npm.

```bash
dsh plugin --profile <profile> add github:pengtang1024/dsh-paste-image
```

Para desenvolvimento local, aponte o profile para o seu checkout:

```bash
dsh plugin --profile <profile> add file:/absolute/path/to/dsh-paste-image
```

Substitua `<profile>` pelo profile em que o seu app roda. **Recarregue a página depois de instalar** (`Ctrl+R`, ou `Cmd+R` no macOS). O módulo do cliente só é injetado quando o renderer carrega, então um plugin recém-instalado não intercepta nada até você recarregar.

## Verifique se funciona

Rode as verificações do repositório:

```bash
cd dsh-paste-image
npm test
npm run check
```

`npm test` roda a suíte de testes Node: detecção por magic bytes, identificação de candidatos, cada variante de BMP, a conversão de PNG rotulado como BMP, DIBs sem cabeçalho, o repasse intacto de nativos e os metadados de exibição distribuídos para cada idioma. `npm run check` faz a verificação de sintaxe de `client.js` e `lib/index.js`.

Depois confira o fluxo real:

1. Recarregue a janela do DSH.
2. Tire uma captura de tela com a sua ferramenta de costume e cole no composer, ou arraste um arquivo de imagem para dentro dele.
3. O anexo aparece. Abra o DevTools (`Ctrl+Shift+I`) → Console, mude o nível para **Verbose** e procure uma linha como:

```text
[dsh-paste-image] image/xpm -> image/png 1440x900
```

Se a conversão falhar, o plugin mantém o arquivo original e registra `keep original (...)`.

## Configurações

As configurações do plugin agora ficam em **Configurações → Colar qualquer imagem**, que abre diretamente o formulário completo. A entrada anterior pela linha do plugin continua disponível: **Configurações → Extensões → dsh-paste-image → Configurar**; a linha do plugin também mostra um resumo de uma linha (ativado / desativado) que leva ao mesmo formulário. Ambas as entradas compartilham as mesmas configurações, então basta alterar uma.

## Limitações

- **XPM:** apenas o formato de texto XPM3. O parser lê a chave de cor `c`; outras chaves, como `m`, `g` e `s`, são ignoradas. As cores são resolvidas pelo parser CSS do navegador, então nomes de paleta que não são cores CSS válidas, como o `light gray` de duas palavras, caem para preto opaco.
- **BMP:** 1/4/8/16/24/32 bits, `BI_RGB`, `BI_RLE8`, `BI_RLE4`, `BI_BITFIELDS` e `BI_ALPHABITFIELDS`, com cabeçalhos core, estendido, V4/V5 ou OS/2 — além de DIBs sem cabeçalho. Variantes de 2 bits e de 64 bits por pixel não são suportadas. Para arquivos de 32 bits sem máscara alfa declarada, um canal alfa todo zerado é tratado como opaco em vez de produzir um PNG totalmente transparente.
- **Outros codecs:** SVG é rasterizado internamente; ICO/CUR recorrem a entradas comprimidas em PNG; AVIF depende do decodificador do navegador. TIFF e HEIC são detectados, mas o Chromium não traz codec para eles, então o original passa intacto e o host o rejeita como antes. Nenhum decodificador de terceiros está incluído.
- **Tamanho:** imagens convertidas são reduzidas a no máximo 4096 px no lado mais longo. Arquivos nativos que passam intactos não são redimensionados.
- **Quantidade de arquivos:** uma colagem ou soltura pode conter no máximo 8 arquivos. Lotes maiores são deixados inteiramente para o caminho nativo.
- **Achatamento:** uma imagem convertida vira um único quadro estático no formato de saída escolhido (WebP por padrão). Animação, metadados EXIF e perfis de cor embutidos não são preservados.
- **Escopo:** apenas os caminhos `paste` e `drop` são cobertos. O seletor de arquivos e outros caminhos de inserção mantêm o comportamento nativo.

## Segurança e privacidade

- Tudo roda no renderer. O plugin não faz requisições de rede, não envia nada e não armazena nada.
- Não há processo em segundo plano, polling da área de transferência nem alteração no código do host do DSH.
- Os bytes da imagem são lidos apenas do evento de paste ou drop, decodificados localmente e devolvidos à mesma janela.
- Os decodificadores são pequenos, mas processam entrada não confiável. Se você encontrar um crash ou um bug de parsing, veja [SECURITY.md](SECURITY.en.md).

## Idiomas

O plugin distribui metadados de exibição para todos os idiomas que a interface do DSH suporta — inglês, chinês simplificado, espanhol, francês, alemão, russo e português. Cada `locale/<language>.json` traz o título e a descrição localizados e aponta sua página de detalhes para o README correspondente neste repositório, para que o Plugin Manager e sua página de detalhes falem o mesmo idioma do app.

As traduções são arquivos-fonte ao lado do código, não texto gerado. A suíte de testes verifica que todo idioma anunciado tem um arquivo de locale, um documento de detalhes e links para os outros READMEs. Para corrigir ou adicionar uma tradução, veja [Contributing](CONTRIBUTING.en.md#translations).

## Documentação

- [Como funciona](docs/en/how-it-works.md) — fluxo de eventos, interior dos decodificadores e um mapa do código função por função.
- [Suporte a formatos](docs/en/formats.md) — pipeline de decisão, matriz de formatos, variantes de BMP e o checklist para adicionar um formato.
- [Solução de problemas](docs/en/troubleshooting.md) — falhas comuns e como ler os logs.
- [Publicação](docs/en/releasing.md) — política de versões e o checklist de release do mantenedor.

## Comunidade

- [Como contribuir](CONTRIBUTING.en.md) — configuração do ambiente, testes, estilo, traduções e o que uma contribuição de formato exige.
- [Código de Conduta](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1.
- [Política de segurança](SECURITY.en.md) — relato privado, escopo e versões suportadas.
- [Changelog](CHANGELOG.en.md) e [releases](https://github.com/pengtang1024/dsh-paste-image/releases) — o que mudou e por quê.
- [Issues](https://github.com/pengtang1024/dsh-paste-image/issues) — relatos de bugs e pedidos de formato.

## Licença

MIT © 2026 pengtang1024. Veja [LICENSE](LICENSE).

## Apoie este projeto

Se este plugin tem sido útil no seu dia a dia, dê uma estrela ⭐ ao [dsh-paste-image](https://github.com/pengtang1024/dsh-paste-image). Esse pequeno gesto me motiva muito a continuar mantendo-o.
