# Viajar Travel News — nova versão Astro

Projeto paralelo de migração. Os arquivos do site legado na raiz do repositório
não são usados como código-fonte e não devem ser alterados durante a migração.

## Stack

- Astro com saída totalmente estática
- TypeScript em modo estrito
- Tailwind CSS
- Firebase Hosting para publicação
- Firebase Authentication, Firestore e Cloud Functions somente para o painel de métricas

## Requisitos

- Node.js 22.22 ou superior
- npm 10 ou superior

## Comandos

```sh
npm install --no-bin-links
npm run dev
npm run check
npm run build
```

`--no-bin-links` é necessário no volume atual, que não permite links simbólicos.
Os scripts do projeto já chamam os executáveis Node diretamente.

## Princípios da migração

1. Preservar a identidade visual aprovada: marca, cores, caráter editorial e fotografia.
2. Melhorar tipografia, hierarquia, responsividade, acessibilidade e desempenho.
3. Preservar URLs e métricas antes de qualquer limpeza definitiva.
4. Copiar apenas mídia realmente usada para `public/assets`, com nomes normalizados.
5. Não adicionar CMS, banco de dados ou renderização no servidor sem necessidade comprovada.

## Métricas

Durante a migração, GA4 e a coleta própria permanecem ativas em paralelo. Depois
da publicação, os relatórios devem ser comparados por 30 dias. A coleta própria
só poderá ser removida após aprovação explícita e confirmação de que o GA4 cobre
os indicadores exigidos pela proprietária.
