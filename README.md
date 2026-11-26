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

## Colocando no ar no Render (recomendado)

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
