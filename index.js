import express from 'express'
import cors from 'cors'

//Importação das Rotas

// Adm Master
import loginMaster from './routes/ADM_MASTER/public.js'
import routePrivateMaster from './routes/ADM_MASTER/private.js'
//Adm
import loginAdm from './routes/ADM/public.js'
import routePrivateAdm from './routes/ADM/private.js'
//Funcionário
import loginFuncionario from './routes/EMPLOYEES/public.js'
import routePrivateFuncionario from './routes/EMPLOYEES/private.js'

// autenticação de token para rotas privadas
import authToken from './middlewares/authToken.js'

const app = express()
app.use(cors())
app.use(express.json())

//Definição das Rotas

// Rotas Públicas
app.use(
  '/',
  // ADM Master
  loginMaster,
  // ADM
  loginAdm,
  // User
  loginFuncionario
)

// Rotas Privadas
app.use(
  '/',
  authToken,
  // ADM Master
  routePrivateMaster,
  // ADM
  routePrivateAdm,
  // User
  routePrivateFuncionario
)

app.listen(3000, () => {
  console.log('Servidor rodando na porta 3000')
})
