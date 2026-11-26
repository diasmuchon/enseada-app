# Condomínio Enseada 🌊

Aplicativo web responsivo (PWA) do Condomínio Enseada, em português, com:

1. **Alerta de alagamento**: administrador, operador, porteiro ou manobrista aciona o botão e **todos** os usuários cadastrados recebem notificação no celular (push), um aviso em destaque no app e um e-mail. Quando o alerta é encerrado, todos também são avisados.
2. **Correspondências e encomendas**: o porteiro registra a chegada pelo número do apartamento. Os moradores daquele apartamento recebem push, notificação no app e e-mail. Na retirada, o porteiro registra quem retirou.
3. **Garagem (manobrista)**:
   - registra a entrada de veículos (apto, placa, modelo, cor e vaga) e a saída deles. Placas que o apartamento já usou aparecem como sugestão.
   - **Admin, operador, porteiro e manobrista** veem todos os carros estacionados. **O morador vê apenas o veículo do próprio apartamento.**
   - Botão **"Manobrando"**: avisa em tempo real a quem consulta o app que é preciso aguardar.
   - Botão **"Vagas disponíveis / Garagem lotada"**.

Todas as telas são atualizadas em tempo real, sem recarregar a página.

## Perfis de acesso

| Perfil | Alagamento | Encomendas | Garagem | Usuários |
|---|---|---|---|---|
| Administrador | aciona | registra/entrega | gerencia e vê tudo | gerencia |
| Operador | aciona | registra/entrega | gerencia e vê tudo | – |
| Porteiro | aciona | registra/entrega | vê tudo | – |
| Manobrista | aciona | – | gerencia e vê tudo | – |
| Morador | recebe | vê as suas | vê só o seu carro | – |

Os moradores podem se cadastrar pela tela inicial em "Criar cadastro". O acesso só é liberado depois que o administrador aprova, e o morador recebe um e-mail avisando. O administrador também pode criar usuários diretamente, inclusive funcionários.

## Como rodar

Requer **Node.js 22.13 ou superior**. O banco de dados (SQLite) já vem embutido no Node.

```bash
npm install
cp .env.example .env   # edite os valores
node --env-file=.env --disable-warning=ExperimentalWarning server/index.js
# ou, sem .env: npm start
```

Acesse http://localhost:3000. No primeiro acesso, entre com `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Se não forem definidos, use `admin@enseada.local` / `enseada123` e **troque a senha** em Perfil.

Testes: `npm test`

## Colocando no ar de graça na alwaysdata (sem cartão)

A [alwaysdata](https://www.alwaysdata.com) tem um plano gratuito permanente para uso pessoal/sem fins lucrativos, sem cartão de crédito: 1 GB de disco, HTTPS e e-mail. O app usa cerca de 10 MB.

1. **Conta**: cadastre-se em alwaysdata.com, escolha o plano **Free** e um nome de conta, por exemplo `enseada`. O endereço do app será `https://enseada.alwaysdata.net`.
2. **Node.js**: no painel, vá em *Environment → Node.js* e escolha a versão **22** (ou 24).
3. **SSH**: em *Remote access → SSH*, defina uma senha e habilite o login por senha. Depois conecte do computador (no Windows, use o PowerShell): `ssh enseada@ssh-enseada.alwaysdata.net`
4. **Acesso ao GitHub** (repositório privado). No SSH, rode:
   ```bash
   ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
   ```
   Copie a linha exibida e cole no GitHub em *Settings → Deploy keys → Add deploy key* do repositório, sem marcar escrita.
5. **Baixar e instalar**:
   ```bash
   git clone -b ccr-e7744be8-1a2566 git@github.com:diasmuchon/enseada-app.git ~/enseada
   cd ~/enseada && npm ci --omit=dev
   ```
6. **Site**: em *Web → Sites*, edite o site existente (ou adicione um):
   - Tipo: **Node.js**
   - Comando: `node --disable-warning=ExperimentalWarning server/index.js`
   - Diretório de trabalho: `enseada`
   - Variáveis de ambiente (uma por linha):
     ```
     ADMIN_EMAIL=seu@email.com
     ADMIN_PASSWORD=uma-senha-forte
     APP_URL=https://enseada.alwaysdata.net
     SMTP_HOST=smtp.gmail.com
     SMTP_PORT=587
     SMTP_USER=condominioenseada@gmail.com
     SMTP_PASS=senha-de-app-do-gmail
     EMAIL_FROM=Condomínio Enseada <condominioenseada@gmail.com>
     ```
   - Em *Avançado*, coloque **tempo ocioso (idle time) = 0** para o app não "dormir".
   - Na aba *SSL*, marque **Forçar HTTPS**.
7. Abra `https://enseada.alwaysdata.net` e entre com o `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

**E-mail**: no Gmail, ative a verificação em 2 etapas e gere uma *senha de app* em https://myaccount.google.com/apppasswords. Outra opção é criar um endereço `@alwaysdata.net` em *Emails* no painel e usar `SMTP_HOST=smtp-enseada.alwaysdata.net`.

**Atualizar o app** depois de mudanças: `cd ~/enseada && git pull && npm ci --omit=dev`, depois reinicie o site no painel (*Web → Sites → ⟳*).

**Backup**: o banco fica em `~/enseada/data/enseada.db`. A alwaysdata guarda backups de 3 dias; para ter mais, baixe esse arquivo de vez em quando (via SFTP).

## Colocando no ar no Render (pago, ~US$ 7/mês)

1. Crie uma conta em https://render.com (pode entrar com o GitHub).
2. **New + → Blueprint**, conecte o repositório `enseada-app` e escolha o branch atual. O Render lê o `render.yaml`.
3. Preencha as variáveis pedidas:
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD`: login do primeiro administrador.
   - `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM`: e-mail de envio. No Gmail, ative a verificação em 2 etapas e gere uma *senha de app* em https://myaccount.google.com/apppasswords.
4. Clique em **Apply**. Em poucos minutos o app fica no ar em `https://enseada-XXXX.onrender.com`, já com HTTPS.
5. (Opcional) Em **Settings → Custom Domains**, aponte um domínio próprio, por exemplo `app.condominioenseada.com.br`.

Custo: plano Starter (~US$ 7/mês) + disco de 1 GB (~US$ 0,25/mês). O plano gratuito **não serve**: ele apaga os dados a cada reinício e "dorme" sem uso, o que atrasaria os alertas.

Alternativas: o `Dockerfile` funciona em Railway, Fly.io ou qualquer VPS. Monte um volume em `/data`.

## Colocando no ar (produção)

- **HTTPS é obrigatório** para as notificações push funcionarem fora do `localhost`.
- O banco é um arquivo SQLite (`DB_PATH`). Use um disco persistente: um volume no Railway/Render/Fly.io ou uma pasta em uma VPS. Faça backup desse arquivo.
- As chaves de push (VAPID) são geradas no primeiro uso e salvas no banco. Se você recriar o banco, os aparelhos se reinscrevem automaticamente ao abrir o app.
- Para e-mail, configure um SMTP: Gmail com "senha de app", SendGrid, Amazon SES, Brevo etc.

## Notificações no celular

- **Android (Chrome)**: abra o site, toque em "Ativar" no aviso da tela inicial e permita as notificações. Para ficar como app, use "Adicionar à tela inicial".
- **iPhone (iOS 16.4+)**: no Safari, toque em **Compartilhar → Adicionar à Tela de Início**. Abra o app pelo ícone e ative as notificações em **Perfil**. O iOS não envia push para sites abertos direto no Safari.
- Cada usuário pode desativar os e-mails em **Perfil**.

## Estrutura

```
server/index.js    rotas da API e regras de permissão
server/db.js       esquema do banco SQLite
server/auth.js     login, sessões e perfis
server/notify.js   push (web-push), e-mail (nodemailer) e tempo real (SSE)
public/            app (HTML/CSS/JS), service worker, manifest e ícones
test/              testes da API
```
