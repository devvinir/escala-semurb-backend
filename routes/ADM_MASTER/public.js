import express from 'express'
import dotenv from 'dotenv'
import jwt from 'jsonwebtoken'

dotenv.config()

const route = express.Router()

route.post('/loginMaster', async (req, res) => {
  try {
    const { registration, password } = req.body

    if (!registration || !password) {
      return res.status(400).json({ message: 'registration e password são obrigatórios' })
    }

    const expectedReg = process.env.REGISTRATION_MASTER
    const expectedPass = process.env.PASSWORD_MASTER

    // retorna 401 se qualquer credencial estiver incorreta
    if (registration !== expectedReg || password !== expectedPass) {
      return res.status(401).json({ message: 'Credenciais inválidas' })
    }

    // gerar token JWT para autenticação
    const token = jwt.sign({ registration }, process.env.JWT_SECRET, { expiresIn: '12h' })

    res.status(200).json({ message: 'Login bem-sucedido', token })
  } catch (error) {
    console.error('Erro ao fazer login:', error)
    res.status(500).json({ error: 'Erro com o servidor' })
  }
})

export default route
