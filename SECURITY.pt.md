# Política de Segurança

## Versões suportadas

| Versão | É suportada                                                 |
| ------ | ----------------------------------------------------------- |
| 0.2.x  | Sim — linha de lançamento atual                             |
| 0.1.x  | Não — atualize para 0.2.x, que substituiu a versão anterior |

O plugin ainda não lançou a versão 1.0; portanto, as correções de segurança são publicadas em uma nova versão de patch da versão minor atual, e não são portadas para linhas de versão mais antigas.

## Como relatar vulnerabilidades

Relate em particular. Use o relatório privado de vulnerabilidades do GitHub: abra a aba **Security** do repositório e selecione **Report a vulnerability**. Se esse fluxo não estiver disponível, entre em contato com o mantenedor no GitHub [@pengtang1024](https://github.com/pengtang1024) para solicitar um canal privado — não divulgue detalhes de exploração em uma issue pública.

Um bom relatório deve incluir:

- A versão do DSH e como o plugin foi instalado.
- O sistema operacional e a sessão da área de trabalho.
- O formato ou decodificador afetado (XPM, BMP, detecção por sondagem, caminho de redrop).
- Um material mínimo de reprodução: o arquivo ou os bytes exatos, e os passos para reproduzir.
- A saída do Console no nível Verbose, incluindo todas as linhas `[dsh-paste-image]`.

Faremos o possível para confirmar o recebimento do relatório; após a confirmação, a correção será publicada em uma versão de patch; a menos que você prefira de outra forma, agradeceremos nas notas de lançamento.

## Escopo

O `dsh-paste-image` executa-se inteiramente no processo de renderização do DSH. Ele não acessa a rede, não tem processos em segundo plano, não consulta a área de transferência periodicamente e não modifica o código do host do DSH. Todo o seu trabalho consiste em: ler arquivos de eventos `paste` ou `drop`, decodificá-los localmente, recodificá-los no formato de saída escolhido (WebP por padrão) e, em seguida, despachar um evento `drop` sintético na mesma janela.

Dentro do escopo:

- Falhas, travamentos ou esgotamento de memória causados por arquivos XPM ou BMP especialmente construídos.
- Erros de pixels causados por falhas no analisador (parser), que podem induzir o usuário em erro.
- Formas de contornar os limites documentados (8 arquivos por evento, maior lado da imagem convertida de 4096 px).
- Métodos que façam o plugin ler ou transferir dados além do escopo dos arquivos colados ou arrastados.

Fora do escopo:

- Vulnerabilidades no próprio DSH, no Electron/Chromium ou no sistema operacional.
- Ataques que já exigem controle do processo de renderização ou a capacidade de instalar plugins; esse tipo de código já possui permissões completas de página.
- Relatórios de engenharia social e negação de serviço causada por arquivos comuns de tamanho extremo que o próprio navegador não consegue processar.

## Notas de projeto

- O plugin lê bytes apenas de `clipboardData.files` ou `dataTransfer.files` do evento.
- A decodificação usa os codecs integrados do navegador, além de dois pequenos analisadores locais; nenhum dado é enviado para fora.
- Os arquivos convertidos são novos objetos `File` em memória. Nada é gravado em disco e nada permanece após o descarregamento da página.
- Não há dependências de terceiros em tempo de execução.
