# Cadastro SG Fibra

Aplicacao separada para receber cadastro de cliente e enviar ao SGP sem expor `app` e `token` no navegador.

## Publicacao recomendada

1. Suba esta pasta como um Web Service no Render.
2. Configure as variaveis de ambiente no painel do Render:
   - `SGP_APP`
   - `SGP_TOKEN`
   - `SESSION_SECRET`
   - `SGP_ATTACH_PATH`, caso o endpoint de anexo do SGP seja diferente do padrao
   - `PLANS_JSON`, mantendo apenas planos de internet no formulario publico
   - demais IDs de contrato, se for criar contrato automaticamente
   - `INSTALLATION_SERVICE_DESCRIPTION`, caso queira personalizar o texto enviado como detalhes do servico solicitado na instalacao
   - `ADMIN_USER` e `ADMIN_PASSWORD`, para liberar o painel operacional em `/admin`
   - `CONTACT_WHATSAPP`, para aparecer no e-mail de boas-vindas
   - `CONFIRMATION_EMAIL_ENABLED=true` e `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, caso queira enviar e-mail automatico de confirmacao ao cliente pelo Brevo
   - `CONFIRMATION_EMAIL_ATTACH_TERM=true`, caso queira anexar o termo/contrato eletronico retornado pelo SGP
   - `SMTP_*`, caso prefira usar SMTP em vez da API do Brevo
3. No Render, cadastre o dominio:
   - `cadastro.sgfibra.com.br`
4. No Registro.br, crie o apontamento DNS indicado pelo Render para esse subdominio.

## Segurança

- O token nao fica no GitHub.
- A senha do e-mail/SMTP tambem deve ficar somente no Render.
- A chave do Brevo tambem deve ficar somente no Render.
- O token nao aparece no HTML, CSS ou JavaScript do cliente.
- O formulario usa CSRF, cookie seguro, honeypot, limite diario simples, limite de tamanho para documentos e cabecalhos de seguranca.
- As fotos do documento passam pelo servidor antes de seguir para a aba Documentos do cliente no SGP; `app` e `token` continuam ocultos.
- O painel operacional fica protegido por senha e mostra apenas logs recentes em memoria.
- A pagina vem com `noindex`, porque e um link operacional para clientes, nao uma pagina para aparecer no Google.

Depois de gerar um novo token no SGP, use apenas no painel do Render.
