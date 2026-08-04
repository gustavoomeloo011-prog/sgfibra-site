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
3. No Render, cadastre o dominio:
   - `cadastro.sgfibra.com.br`
4. No Registro.br, crie o apontamento DNS indicado pelo Render para esse subdominio.

## Segurança

- O token nao fica no GitHub.
- O token nao aparece no HTML, CSS ou JavaScript do cliente.
- O formulario usa CSRF, cookie seguro, honeypot, limite diario simples, limite de tamanho para documentos e cabecalhos de seguranca.
- As fotos do documento passam pelo servidor antes de seguir para o SGP; `app` e `token` continuam ocultos.
- A pagina vem com `noindex`, porque e um link operacional para clientes, nao uma pagina para aparecer no Google.

Depois de gerar um novo token no SGP, use apenas no painel do Render.
