# Métricas do site

O Google Analytics 4 é carregado nas páginas públicas por meio de
`js/google-analytics.js`, usando o ID configurado em `js/metrics-config.js`.
Ele funciona em paralelo à coleta própria abaixo e não é carregado no painel
`metricas.html` nem fora dos domínios autorizados.

A coleta registra apenas nos domínios de produção e de prévia autorizados:

- visitantes únicos estimados por navegador e mês, derivados das visualizações;
- sessões, derivadas das visualizações (uma nova após 30 minutos sem atividade);
- páginas visualizadas;
- tempo de engajamento com a página visível;

Cada visualização guarda o caminho completo, incluindo parâmetros como
`paginas.html?id=29`, e o título apresentado na matéria.
No painel, `/` e `/index.html` são agrupados como `Página inicial`; páginas sem
título específico recebem um nome amigável derivado do endereço.

A cidade, o estado e o país são estimados pela API `ipwho.is`. A visualização é
gravada imediatamente; a localização é salva separadamente uma vez por visitante
e mês. A consulta externa ocorre no máximo uma vez por navegador a cada 30 dias,
e o endereço IP não é salvo no Firestore. A localização pode estar incorreta em
redes móveis, corporativas ou VPN.

Os eventos ficam em `metricSites/viajar-travel-news/months/AAAA-MM`, separados
dos demais sites do projeto. O Firebase Authentication cria um usuário anônimo
persistente por navegador. Nenhum endereço IP é consultado ou armazenado.

## Configuração antes da publicação

1. O app Web `Viajar Travel News` e o provedor de login anônimo já foram ativados.
2. As regras em `firestore.rules` permitem somente a criação de eventos válidos
   pelo próprio usuário anônimo. O navegador não pode ler, alterar ou apagar métricas.
3. O App Check foi registrado, mas não está em uso nem em modo obrigatório. Isso
   evita afetar os outros sites que compartilham o projeto e não gera avaliações
   do reCAPTCHA pela coleta atual.
4. Para iniciar a coleta, altere `enabled` para `true` em `js/metrics-config.js` e
   publique o Hosting de produção.
5. Publique mudanças futuras das regras com `npm run deploy:metrics`.

## Painel administrativo

O painel fica em `/metricas.html` e exige login com e-mail e senha. As regras
autorizam somente `heberluiz1811@gmail.com` e `hudson.m.3110@gmail.com`. O painel
permite escolher um dos últimos 24 meses, exibe indicadores e gráficos e exporta
o resumo em CSV ou PDF. O relatório por página mostra visualizações, tempo total
e tempo médio por acesso. A opção PDF usa a janela de impressão do navegador.

Se uma dessas contas ainda não existir no Firebase Authentication, crie-a em
Authentication > Usuários > Adicionar usuário. Alterações na lista de e-mails
devem ser feitas tanto em `firestore.rules` quanto em `js/metrics-config.js`.

O arquivo de regras está ligado ao `firebase.json`. Se as regras do console forem
alteradas no futuro, replique a mudança no repositório antes da próxima publicação.

## Relatório e custo

O relatório mensal pode contar os documentos de `visitors`, `sessions` e
`pageViews`, e somar `seconds` em `engagement`. O tempo médio é essa soma dividida
pelo número de sessões. A leitura desses dados deve ser feita pelo Console do
Firebase ou por uma área administrativa autenticada; visitantes não têm leitura.

As gravações de engajamento são agrupadas em intervalos de aproximadamente um
minuto. Isso reduz custo sem contar tempo em que a aba ficou oculta.
Visitantes e sessões não exigem gravações separadas: o painel conta os
identificadores presentes nas visualizações, reduzindo o custo da coleta.
Em um site de tráfego pequeno, a tendência é permanecer nas cotas gratuitas do
Firestore, mas o plano Blaze cobra qualquer uso que ultrapasse essas cotas.
