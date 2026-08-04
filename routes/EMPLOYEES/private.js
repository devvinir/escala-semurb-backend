import express from 'express'
import supabase from '../../supabase.js'
import bcrypt from 'bcrypt'
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { get } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: multer.memoryStorage() });

const route = express.Router()

// Função para validar campos obrigatórios
function validarCampos(campos, body) {
  for (const campo of campos) {
    if (!body[campo]) return campo
  }
  return null
}

// confirmação de leitura da escala
route.put('/confirmacaoEscala/:matricula_funcionario', async (req, res) => {
  const { matricula_funcionario } = req.params

  try {
    // Buscar a confirmação mais recente
    const { data: ultimaConfirmacao, error: erroBusca } = await supabase
      .from('escala_confirmacao')
      .select('*')
      .eq('matricula_funcionario', matricula_funcionario)
      .order('data_confirmacao', { ascending: false }) // pega a mais recente
      .limit(1)

    if (erroBusca) {
      return res
        .status(500)
        .json({ message: 'Erro ao buscar confirmação.', error: erroBusca.message })
    }

    if (ultimaConfirmacao && ultimaConfirmacao.length > 0) {
      const confirmacao = ultimaConfirmacao[0]

      if (confirmacao.status === 'Confirmado') {
        return res.status(400).json({ message: 'A escala mais recente já foi confirmada.' })
      }

      // Atualizar somente a mais recente
      const { data: confirmada, error: erroUpdate } = await supabase
        .from('escala_confirmacao')
        .update({
          status: 'Confirmado',
          data_confirmacao: new Date().toISOString()
        })
        .eq('id_confirmacao', confirmacao.id_confirmacao) // atualiza só a última
        .select()
        .single()

      if (erroUpdate) {
        return res
          .status(500)
          .json({ message: 'Erro ao confirmar escala.', error: erroUpdate.message })
      }

      return res.status(200).json({ message: 'Escala confirmada com sucesso.', confirmada })
    }

    return res.status(404).json({ message: 'Nenhuma escala encontrada para esse funcionário.' })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao confirmar escala.', error: error.message })
  }
})

// alteração de senha

route.put('/alterarSenha', async (req, res) => {
  const { matricula_funcionario, nova_senha, confirmar_nova_senha } = req.body

  try {
    // validação de entrada
    if (!matricula_funcionario || !nova_senha || !confirmar_nova_senha) {
      return res.status(400).json({ message: 'Matrícula e nova senha são obrigatórias.' })
    }

    // vericar se ambas a senhas são iguais
    if (nova_senha != confirmar_nova_senha) {
      return res.status(400).json({ message: 'Senhas diferentes! Verifique e tente novamente.' })
    }

    // gerar hash da nova senha
    const saltRounds = parseInt(process.env.SALT_ROUNDS) || 10
    const hashedPassword = await bcrypt.hash(nova_senha, saltRounds)

    // atualizar a senha no banco de dados
    const { data, error } = await supabase
      .from('funcionario')
      .update({ senha: hashedPassword })
      .eq('matricula_funcionario', matricula_funcionario)
      .select('matricula_funcionario, nome') // não retorna senha

    if (error) {
      throw error
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ message: 'Funcionário não encontrado.' })
    }

    res.status(200).json({ message: 'Senha alterada com sucesso.', funcionario: data[0] })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao alterar senha.', error: error.message })
  }
})

// editar informacoes
route.put('/editarInformacoes/:matricula_funcionario', async (req, res) => {
  try {
    const { matricula_funcionario } = req.params
    const camposObrigatorios = ['email', 'telefone']

    const campoFaltando = validarCampos(camposObrigatorios, req.body)
    if (campoFaltando) {
      return res.status(400).json({ mensagem: `Preencha o campo obrigatório: ${campoFaltando}` })
    }

    const { email, telefone } = req.body

    const { data, error } = await supabase
      .from('funcionario')
      .update({ email, telefone })
      .eq('matricula_funcionario', matricula_funcionario)
      .select('matricula_funcionario, nome, email, telefone')

    if (error) {
      throw error
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ message: 'Funcionário não encontrado.' })
    }

    res.status(200).json({ message: 'Informações atualizadas com sucesso.', funcionario: data[0] })
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar informações.', error: error.message })
  }
})

route.get('/diasEspecificos', async (req, res) => {
  try {
    const { data: diasEspecificos, error } = await supabase.from('occasion').select('*')

    if (error) {
      return res.status(400).json({
        mensagem: 'Erro ao listar dias específicos do funcionário',
        erro: error.message
      })
    }

    return res.status(200).json({
      mensagem: 'Listagem bem-sucedida',
      diasEspecificos
    })
  } catch (err) {
    return res.status(500).json({
      mensagem: 'Erro no servidor',
      erro: err.message
    })
  }
})

// adicionar imagem de perfil
route.post(
  '/uploadImagemPerfil/:matricula_funcionario',
  upload.single('file'),
  async (req, res) => {
    try {
      const { matricula_funcionario } = req.params

      console.log("Upload recebido para matrícula:", matricula_funcionario)
      console.log("Arquivo recebido:", req.file?.originalname)

      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' })
      }

      

      // Verificar se o funcionário existe
      const { data: funcionario, error: funcionarioError } = await supabase
        .from('funcionario')
        .select('*')
        .eq('matricula_funcionario', matricula_funcionario)
        .single()

      if (funcionarioError) {
        console.log("Erro ao consultar funcionário:", funcionarioError)
        return res.status(500).json({
          error: 'Erro na consulta do funcionário.',
          detalhes: funcionarioError,
        })
      }

      if (!funcionario) {
        console.log("Funcionário não encontrado.");
        return res.status(404).json({ error: 'Funcionário não encontrado.' })
      }

      //verificar se o funcionario ja tem uma imagem cadastrada
      const { data: imagemExistente, error: imagemError } = await supabase
        .from('imagem_perfil')
        .select('*')
        .eq('matricula_funcionario', matricula_funcionario)
        .maybeSingle()

      if (imagemError) {
        console.log("Erro ao consultar imagem existente:", imagemError)
        return res.status(500).json({
          error: 'Erro na consulta da imagem existente.',
          detalhes: imagemError,
        })
      }

      if (imagemExistente) {
        res.status(400).json({ error: 'Imagem de perfil já existe para este funcionário.' })
        console.log("Imagem de perfil já existe para este funcionário.");
        return
      }

      // Ler o arquivo enviado
      const data = req.file.buffer;
      const hex = '\\x' + data.toString('hex') // bytea no PostgreSQL

      // Inserir no banco de dados
      const { error: supabaseError } = await supabase
        .from('imagem_perfil')
        .insert([
          {
            matricula_funcionario,
            imagem: hex,
          },
        ])

      if (supabaseError) {
        console.log("Erro Supabase Insert:", supabaseError);
        return res.status(500).json({
          error: 'Erro ao armazenar no Supabase.',
          detalhes: supabaseError,
        })
      }

      console.log("Upload salvo para funcionário:", matricula_funcionario)

      return res.status(200).json({
        mensagem: "Imagem enviada com sucesso.",
        arquivo: req.file.originalname,
      })

    } catch (error) {
      console.error("Erro inesperado:", error)
      return res.status(500).json({ error: 'Erro inesperado no servidor.' })
    }
  }
)

route.put('/uploadImagemPerfil/:matricula_funcionario', upload.single('file'), async (req, res) => {
  try {
    const { matricula_funcionario } = req.params

    console.log("Upload recebido para matrícula:", matricula_funcionario)
    console.log("Arquivo recebido:", req.file?.originalname)

    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' })
    }

    

    // Verificar se o funcionário existe
    const { data: funcionario, error: funcionarioError } = await supabase
      .from('funcionario')
      .select('*')
      .eq('matricula_funcionario', matricula_funcionario)
      .single()

    if (funcionarioError) {
      console.log("Erro ao consultar funcionário:", funcionarioError)
      return res.status(500).json({
        error: 'Erro na consulta do funcionário.',
        detalhes: funcionarioError,
      })
    }

    if (!funcionario) {
      console.log("Funcionário não encontrado.");
      return res.status(404).json({ error: 'Funcionário não encontrado.' })
    }

    // Ler o arquivo enviado
    const data = req.file.buffer;
    const hex = '\\x' + data.toString('hex') // bytea no PostgreSQL

    // Atualizar no banco de dados
    const { error: supabaseError } = await supabase
      .from('imagem_perfil')
      .update({ imagem: hex })
      .eq('matricula_funcionario', matricula_funcionario)

    if (supabaseError) {
      console.log("Erro Supabase Update:", supabaseError);
      return res.status(500).json({
        error: 'Erro ao atualizar no Supabase.',
        detalhes: supabaseError,
      })
    }

    console.log("Upload atualizado para funcionário:", matricula_funcionario)

    return res.status(200).json({
      mensagem: "Imagem atualizada com sucesso.",
      arquivo: req.file.originalname,
    })

  } catch (error) {
    console.error("Erro inesperado:", error)
    return res.status(500).json({ error: 'Erro inesperado no servidor.' })
  }
})
 
route.get('/imagemPerfil/:matricula_funcionario', async (req, res) => {
  try {
    const { matricula_funcionario } = req.params

    // Buscar a imagem no banco de dados
    const { data: imagemData, error } = await supabase
      .from('imagem_perfil')
      .select('imagem')
      .eq('matricula_funcionario', matricula_funcionario)
      .single()

    if (error) {
      return res.status(500).json({
        mensagem: 'Erro ao buscar imagem de perfil.',
        erro: error.message
      })
    }

    if (!imagemData) {
      return res.status(404).json({ mensagem: 'Imagem de perfil não encontrada.' })
    }

    // Converter o bytea para Buffer
    const imagemBuffer = Buffer.from(imagemData.imagem.slice(2), 'hex')

    // Definir o tipo de conteúdo e enviar a imagem
    res.set('Content-Type', 'image/jpeg') // ou o tipo correto da imagem
    res.send(imagemBuffer)

  } catch (err) {
    return res.status(500).json({
      mensagem: 'Erro no servidor',
      erro: err.message
    })
  }
})



export default route
