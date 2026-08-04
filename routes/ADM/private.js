import express from 'express'
import supabase from '../../supabase.js'
import bcrypt from 'bcrypt'
import PDFDocument from 'pdfkit'

// Função auxiliar para formatar data
function formatarData(data) {
  if (!data) return 'Não informado'
  const d = new Date(data)
  return d.toLocaleDateString('pt-BR')
}

// Função auxiliar para obter nome do mês
function obterNomeMes(mes) {
  const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ]
  return meses[mes - 1] || 'Mês inválido'
}

// Função para adicionar cabeçalho ao PDF
function adicionarCabecalho(doc, titulo, subtitulo = '') {
  doc
    .fontSize(20)
    .font('Helvetica-Bold')
    .text(titulo, { align: 'center' })
    .moveDown(0.5)
  
  if (subtitulo) {
    doc
      .fontSize(12)
      .font('Helvetica')
      .text(subtitulo, { align: 'center' })
      .moveDown(0.5)
  }
  
  doc
    .fontSize(10)
    .text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, { align: 'center' })
    .moveDown(1)
  
  // Linha separadora
  doc
    .moveTo(50, doc.y)
    .lineTo(550, doc.y)
    .stroke()
    .moveDown(1)
}

const route = express.Router()

// Função para validar campos obrigatórios
function validarCampos(campos, body) {
  for (const campo of campos) {
    if (!body[campo]) return campo
  }
  return null
}

async function criarNotificacao({
  matricula_funcionario = null,
  tipo_notificacao = 'GENÉRICA',
  mensagem = '',
  matricula_responsavel = null
}) {
  try {
    const { error } = await supabase.from('notificacoes').insert([
      {
        matricula_funcionario,
        tipo_notificacao,
        mensagem,
        matricula_responsavel,
        lida: false,
        enviada_em: new Date().toISOString()
      }
    ])
    if (error) {
      // não interrompe a operação principal, apenas loga
      console.error('Erro ao criar notificação:', error)
    }
  } catch (err) {
    console.error('Erro inesperado ao criar notificação:', err)
  }
}

// rota para gerar notificacao de um relatorio de quantos funcionarios aina faltam confirmar a escala no setor do adm ( a cada tempo determinado )
route.post('/notificarFaltamConfirmar/:matricula_adm', async (req, res) => {
  try {
    const { matricula_adm } = req.params
    if (!matricula_adm) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM é obrigatória' })
    }
    // buscar setor do adm
    const { data: adm, error: errorAdm } = await supabase
      .from('funcionario')
      .select('id_setor')
      .eq('matricula_funcionario', matricula_adm)
      .maybeSingle()
    if (errorAdm) {
      return res.status(400).json({ mensagem: 'Erro ao buscar ADM', erro: errorAdm })
    }
    if (!adm) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM não encontrada' })
    }

    // buscar funcionarios do setor que possuem escala
    const { data: funcionarios, error } = await supabase
      .from('funcionario')
      .select(
        `matricula_funcionario,
            nome,
            escala_confirmacao:escala_confirmacao!escala_confirmacao_matricula_funcionario_fkey(
                id_confirmacao,
                id_escala,
                data_confirmacao,
                status
            ),
            escala(id_escala, data_inicio, tipo_escala)
        ` )
      .eq('id_setor', adm.id_setor)
      .not('id_escala', 'is', null)
    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao buscar funcionários', erro: error })
    }

    // filtrar funcionarios que nao possuem confirmacao de escala
    const faltamConfirmar = (funcionarios || []).filter(
      f => !f.escala_confirmacao || (Array.isArray(f.escala_confirmacao) && f.escala_confirmacao.length === 0)
    )

    const quantidadeFaltam = faltamConfirmar.length

    // preparar lista de nomes/matrículas para retorno
    const listaNaoConfirmaram = faltamConfirmar.map(f => ({
      matricula: f.matricula_funcionario,
      nome: f.nome || 'Nome não informado'
    }))

    // criar notificacao para o adm (texto breve)
    const mensagemNotificacao = `Existem ${quantidadeFaltam} funcionário(s) que ainda não confirmaram sua escala.`

    await criarNotificacao({
      matricula_funcionario: matricula_adm ,
      tipo_notificacao: 'Pendencias',
      mensagem: mensagemNotificacao
    })

    // retornar quantidade e lista com nomes/matrículas
    res.status(200).json({
      mensagem: 'Notificação criada com sucesso',
      quantidade_faltam: quantidadeFaltam,
      faltam_confirmar: listaNaoConfirmaram
    })
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

//contabilizar funcionarios por equipe
route.get('/funcionariosEquipe/:id_equipe', async (req, res) => {
  try {
    const id_equipe = req.params

    if (!id_equipe) {
      return res.status(400).json({ mensagem: 'ID do setor é obrigatório' })
    }

    //buscar funcionarios que possuem o id da equipe
    const { data: funcionariosEquipe, error } = await supabase
      .from('funcionario')
      .select('equipe(nome_equipe)')
      .eq('id_equipe', id_equipe.id_equipe)
      .not('id_equipe', 'is', null)

    if (error) {
      return res
        .status(400)
        .json({ mensagem: 'Erro ao buscar funcionários da equipe', erro: error })
    }

    const quantidadeFuncionarios = funcionariosEquipe.length
    res.status(200).json({ quantidade: quantidadeFuncionarios })
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// contabilizar funcionarios por escala
route.get('/funcionariosEscala/:matricula_adm', async (req, res) => {
  try {
    const { matricula_adm } = req.params

    if (!matricula_adm) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM é obrigatória' })
    }

    // buscar setor do adm
    const { data: adm, error: errorAdm } = await supabase
      .from('funcionario')
      .select('id_setor')
      .eq('matricula_funcionario', matricula_adm)
      .maybeSingle()

    if (errorAdm) {
      return res.status(400).json({ mensagem: 'Erro ao buscar ADM', erro: errorAdm })
    }

    if (!adm) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM não encontrada' })
    }

    // buscar funcionarios do setor que possuam id_escala e trazer apenas o tipo_escala
    const { data: funcionariosComEscala, error } = await supabase
      .from('funcionario')
      .select('escala(tipo_escala)')
      .eq('id_setor', adm.id_setor)
      .not('id_escala', 'is', null)

    if (error) {
      return res
        .status(400)
        .json({ mensagem: 'Erro ao buscar funcionários com escala', erro: error })
    }

    // Agregar contagem por tipo_escala
    const mapa = new Map()
    for (const f of funcionariosComEscala) {
      const tipo = f.escala && f.escala.tipo_escala ? f.escala.tipo_escala : 'Não informado'
      if (!mapa.has(tipo)) {
        mapa.set(tipo, {
          tipo_escala: tipo,
          quantidade: 0
        })
      }
      mapa.get(tipo).quantidade += 1
    }

    const contagem = Array.from(mapa.values())

    res.status(200).json(contagem)
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// listar equipes do setor (apenas equipes com funcionários no setor)
route.get('/equipesSetor/:matricula_adm', async (req, res) => {
  const { matricula_adm } = req.params
  if (!matricula_adm) {
    return res.status(400).json({ mensagem: 'Matrícula do ADM é obrigatória' })
  }
  try {
    // buscar setor do adm
    const { data: adm } = await supabase
      .from('funcionario')
      .select('id_setor')
      .eq('matricula_funcionario', matricula_adm)
      .maybeSingle()

    if (!adm) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM não encontrada' })
    }

    // buscar equipes diretamente na tabela equipe (retorna todas as equipes do setor)
    const { data: equipes, error } = await supabase
      .from('equipe')
      .select('id_equipe, nome_equipe')
      .eq('id_setor', adm.id_setor)
      .order('nome_equipe', { ascending: true })

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao buscar equipes', erro: error })
    }

    res.status(200).json(equipes || [])
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// listar regiões do setor
route.get('/regiaoSetor/:matricula_adm', async (req, res) => {
  const { matricula_adm } = req.params

  if (!matricula_adm) {
    return res.status(400).json({ mensagem: 'Matrícula do ADM é obrigatória' })
  }

  try {
    //buscar setor do adm
    const { data: setorData } = await supabase
      .from('funcionario')
      .select('id_setor')
      .eq('matricula_funcionario', matricula_adm)
      .maybeSingle()

    if (!setorData) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM não encontrada' })
    }

    // buscar regiões que possuem funcionários no setor
    const { data: regioes, error } = await supabase
      .from('funcionario')
      .select('id_regiao, regiao:regiao(nome_regiao)')
      .eq('id_setor', setorData.id_setor)
      .not('id_regiao', 'is', null)

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao buscar regiões', erro: error })
    }

    // Remover duplicatas e formatar resultado
    const regioesUnicas = []
    const nomesVistos = new Set()
    for (const f of regioes) {
      if (f.regiao && f.regiao.nome_regiao && !nomesVistos.has(f.regiao.nome_regiao)) {
        regioesUnicas.push({
          id_regiao: f.id_regiao,
          nome_regiao: f.regiao.nome_regiao
        })

        nomesVistos.add(f.regiao.nome_regiao)
      }
    }
    res.status(200).json(regioesUnicas)
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

//listar escalas do setor
route.get('/escalasSetor/:matricula_adm', async (req, res) => {
  try {
    const { matricula_adm } = req.params

    if (!matricula_adm) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM é obrigatória' })
    }

    // buscar setor do adm
    const { data: adm } = await supabase
      .from('funcionario')
      .select('id_setor')
      .eq('matricula_funcionario', matricula_adm)
      .maybeSingle()

    if (!adm) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM não encontrada' })
    }

    // buscar escalas do setor
    const { data: escalas, error } = await supabase
      .from('funcionario')
      .select(
        `matricula_funcionario, nome,
            escala(id_escala, data_inicio, dias_trabalhados, dias_n_trabalhados, tipo_escala, dias_n_trabalhados_escala_semanal)`
      )
      .eq('id_setor', adm.id_setor)
      .not('id_escala', 'is', null) // filtrar apenas funcionarios com escala vinculada
      .order('nome', { ascending: true }) // ordenar por nome do funcionário

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao buscar escalas', erro: error })
    }

    res.status(200).json(escalas)
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// listar turnos do setor (retorna todas as informações do turno)
route.get('/turnosSetor/:matricula_adm', async (req, res) => {
  try {
    const { matricula_adm } = req.params
    if (!matricula_adm) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM é obrigatória' })
    }

    // buscar setor do adm
    const { data: adm } = await supabase
      .from('funcionario')
      .select('id_setor')
      .eq('matricula_funcionario', matricula_adm)
      .maybeSingle()

    if (!adm) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM não encontrada' })
    }

    // buscar todos id_turno dos funcionários do setor
    const { data: funcionarios, error: errorFuncionarios } = await supabase
      .from('funcionario')
      .select('id_turno')
      .eq('id_setor', adm.id_setor)
      .not('id_turno', 'is', null)

    if (errorFuncionarios) {
      return res
        .status(400)
        .json({ mensagem: 'Erro ao buscar funcionários do setor', erro: errorFuncionarios })
    }

    // Extrair ids únicos de turno
    const turnosIds = [...new Set(funcionarios.map(f => f.id_turno))]

    if (turnosIds.length === 0) {
      return res.status(200).json([]) // Nenhum turno vinculado
    }

    // Buscar todos os turnos completos pelo id_turno
    const { data: turnos, error: errorTurnos } = await supabase
      .from('turno')
      .select('*')
      .in('id_turno', turnosIds)
      .order('id_turno', { ascending: true })

    if (errorTurnos) {
      return res.status(400).json({ mensagem: 'Erro ao buscar turnos', erro: errorTurnos })
    }

    res.status(200).json(turnos)
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

//listar funcionarios do setor do adm
route.get(`/funcionariosSetor/:matricula_adm`, async (req, res) => {
  try {
    const { matricula_adm } = req.params

    if (!matricula_adm) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM é obrigatória' })
    }

    // buscar setor do adm
    const { data: adm } = await supabase
      .from('funcionario')
      .select('id_setor')
      .eq('matricula_funcionario', matricula_adm)
      .maybeSingle()

    if (!adm) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM não encontrada' })
    }

    // buscar funcionarios do setor
    const { data: funcionarios, error } = await supabase
      .from('funcionario')
      .select('*')
      .eq('id_setor', adm.id_setor)
      .neq('matricula_funcionario', matricula_adm) // Excluir o próprio ADM da lista
      .order('nome', { ascending: true })

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao buscar funcionários', erro: error })
    }

    res.status(200).json(funcionarios)
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// retornar confimação de leitura da escala de todos os funcionarios do setor
route.get('/confirmacoesSetor/:matricula_adm', async (req, res) => {
  try {
    const { matricula_adm } = req.params
    if (!matricula_adm) return res.status(400).json({ mensagem: 'Matrícula do ADM é obrigatória' })

    // Buscar setor do ADM
    const { data: adm, error: errorAdm } = await supabase
      .from('funcionario')
      .select('id_setor')
      .eq('matricula_funcionario', matricula_adm)
      .maybeSingle()

    if (errorAdm) return res.status(400).json({ mensagem: 'Erro ao buscar ADM', erro: errorAdm })
    if (!adm) return res.status(400).json({ mensagem: 'Matrícula do ADM não encontrada' })

    // Buscar confirmações de leitura da escala dos funcionários do setor
    const { data: confirmacoes, error } = await supabase
      .from('funcionario')
      .select(
        `
                matricula_funcionario,
                nome,
                escala_confirmacao:escala_confirmacao!escala_confirmacao_matricula_funcionario_fkey(
                    id_confirmacao,
                    id_escala,
                    data_confirmacao,
                    status
                ),
                escala(id_escala, data_inicio, tipo_escala)
            `
      )
      .eq('id_setor', adm.id_setor)
      .not('id_escala', 'is', null)
      .order('nome', { ascending: true })
      

    if (error) return res.status(400).json({ mensagem: 'Erro ao buscar confirmações', erro: error })

    res.status(200).json(confirmacoes)
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// Mostrar funcionários que estão atuando em determinada data (filtrado por setor do ADM)
route.get('/funcionariosAtivosSetor/:matricula_adm', async (req, res) => {
  const matricula_adm = req.params.matricula_adm
  try {
    let { data: dataConsulta } = req.query
    if (!dataConsulta) {
      return res
        .status(400)
        .json({ mensagem: 'Data é obrigatória no formato DD/MM/YYYY ou YYYY-MM-DD' })
    }

    // aceitar formato DD/MM/YYYY convertendo para ISO YYYY-MM-DD
    if (typeof dataConsulta === 'string' && dataConsulta.includes('/')) {
      const partes = dataConsulta.split('/')
      if (partes.length !== 3) {
        return res
          .status(400)
          .json({ mensagem: 'Formato de data inválido. Use DD/MM/YYYY ou YYYY-MM-DD.' })
      }
      dataConsulta = `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`
    }

    const consultaDate = new Date(dataConsulta)
    if (isNaN(consultaDate.getTime())) {
      return res.status(400).json({ mensagem: 'Data inválida' })
    }

    // buscar setor do adm
    const { data: adm, error: errorAdm } = await supabase
      .from('funcionario')
      .select('id_setor')
      .eq('matricula_funcionario', matricula_adm)
      .maybeSingle()

    if (errorAdm) {
      return res.status(400).json({ mensagem: 'Erro ao buscar ADM', erro: errorAdm })
    }
    if (!adm) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM não encontrada' })
    }

    // Buscar funcionários do mesmo setor com escala vinculada
    const { data: funcionarios, error } = await supabase
      .from('funcionario')
      .select(
        `
                matricula_funcionario, nome, id_escala,
                escala(id_escala, data_inicio, dias_trabalhados, dias_n_trabalhados, tipo_escala, dias_n_trabalhados_escala_semanal)
            `
      )
      .eq('id_setor', adm.id_setor)
      .not('id_escala', 'is', null)

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao buscar funcionários', erro: error })
    }

    // Função local para verificar se o funcionário está ativo na data (recebe Date)
    function estaAtivoNaData(func, consulta) {
      const escala = func.escala
      if (!escala || !escala.data_inicio) return false

      const inicio = new Date(escala.data_inicio)
      if (isNaN(inicio.getTime())) return false
      if (consulta < inicio) return false

      const diffDias = Math.floor((consulta - inicio) / (1000 * 60 * 60 * 24))
      const ciclo = Number(escala.dias_trabalhados) + Number(escala.dias_n_trabalhados)
      if (ciclo === 0) return false

      // Verificação de folgas semanais (dias específicos)
      if (escala.dias_n_trabalhados_escala_semanal) {
        let diasFolga = escala.dias_n_trabalhados_escala_semanal

        // Caso venha em formato de string JSON, converter
        if (typeof diasFolga === 'string') {
          try {
            diasFolga = JSON.parse(diasFolga)
          } catch {
            diasFolga = []
          }
        }

        if (Array.isArray(diasFolga) && diasFolga.length > 0) {
          const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']
          const diaSemana = diasSemana[consulta.getDay()]

          // Normalizar maiúsculas/minúsculas
          const diaNormalizado = diaSemana.toLowerCase().trim()
          const folgasNormalizadas = diasFolga.map(d => String(d).toLowerCase().trim())

          if (folgasNormalizadas.includes(diaNormalizado)) {
            return false // está de folga neste dia
          }
        }
      }

      const posicaoNoCiclo = diffDias % ciclo
      return posicaoNoCiclo < Number(escala.dias_trabalhados)
    }

    // Filtrar os funcionários ativos na data (apenas do setor do ADM)
    const ativos = funcionarios.filter(func => estaAtivoNaData(func, consultaDate))

    res.status(200).json(ativos)
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// Cadastrar funcionário no setor do adm
route.post('/cadastrarFuncionario', async (req, res) => {
  try {
    const obrigatorios = [
      'matricula_adm',
      'matricula_funcionario',
      'nome',
      'email',
      'telefone',
      'nome_regiao',
      'nome_equipe'
    ]
    const campoFaltando = validarCampos(obrigatorios, req.body)
    if (campoFaltando) {
      return res.status(400).json({ mensagem: `Preencha o campo obrigatório: ${campoFaltando}` })
    }

    //verificar se matricula possui 5 digitos
    if (String(req.body.matricula_funcionario).length !== 5) {
      return res.status(400).json({ mensagem: 'A matrícula deve conter exatamente 5 dígitos' })
    }

    const {
      matricula_adm,
      matricula_funcionario,
      nome,
      email,
      telefone,
      cargo,
      nome_regiao,
      nome_equipe
    } = req.body

    let senha = String(matricula_funcionario)
    // Criptografar senha
    const salt = await bcrypt.genSalt(10)
    const senhaHash = await bcrypt.hash(senha, salt)

    let equipeId
    //encontrar equipe pelo nome
    const { data: equipeExistente } = await supabase
      .from('equipe')
      .select('id_equipe')
      .eq('nome_equipe', nome_equipe)
      .maybeSingle()

    if (!equipeExistente) {
      return res.status(400).json({
        mensagem: 'Equipe não encontrada. Cadastre a equipe antes de vincular ao funcionário.'
      })
    } else {
      equipeId = equipeExistente.id_equipe
    }

    let regiaoId
    // encontrar regiao pelo nome
    const { data: regiaoExistente } = await supabase
      .from('regiao')
      .select('id_regiao')
      .eq('nome_regiao', nome_regiao)
      .maybeSingle()

    if (regiaoExistente) {
      // se regiao existe usa o id
      regiaoId = regiaoExistente.id_regiao
    } else {
      // se regiao nao existe cria outra
      const { data: novaRegiao, error: errorNovaRegiao } = await supabase
        .from('regiao')
        .insert([{ nome_regiao: nome_regiao }])
        .select('id_regiao')
        .single()

      if (errorNovaRegiao) {
        return res
          .status(400)
          .json({ mensagem: 'Erro ao criar nova regiao', erro: errorNovaRegiao })
      }

      regiaoId = novaRegiao.id_regiao
    }

    // Verificar se matrícula já existe
    const { data: funcionarioExistente } = await supabase
      .from('employee')
      .select('*')
      .eq('registration', registration)
      .maybeSingle()

    if (funcionarioExistente) {
      return res.status(400).json({ mensagem: 'Matrícula já cadastrada' })
    }

    // verificar setor do adm para vincular ao funcionario
    const { data: adm } = await supabase
      .from('emp´loyee')
      .select('id_setor')
      .eq('registration', matricula_adm)
      .maybeSingle()

    // Inserir funcionário
    const { data, error } = await supabase
      .from('employee')
      .insert([
        {
          registration: matricula_funcionario,
          name: nome,
          email: email,
          password: senhaHash,
          phone: telefone,
          id_region: regiaoId,
          id_team: equipeId,
          id_sector: adm.id_setor,
          position: cargo
        }
      ])
      .select()

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao inserir dados', erro: error })
    }

    // notificar cadastro de funcionário (registro geral)
    await criarNotificacao({
      matricula_funcionario,
      tipo_notificacao: 'Boas Vindas',
      mensagem: `Bem vindo ao sistema de gerenciamento de escalas! Sua matrícula é ${matricula_funcionario}, a mesma é também sua senha inicial. Por favor, altere sua senha após o primeiro acesso.`,
      matricula_responsavel: matricula_adm
    })

    res.status(201).json({ mensagem: 'Funcionário cadastrado com sucesso', funcionario: data[0] })
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// editar informacoes do funcionario do setor do adm
route.put('/editarFuncionario/:matricula_adm', async (req, res) => {
  try {
    const { matricula_adm } = req.params
    const { matricula_funcionario, email, telefone, cargo } = req.body
    let equipe = req.body.equipe
    let regiao = req.body.regiao

    const obrigatorios = ['matricula_funcionario']
    const campoFaltando = validarCampos(obrigatorios, req.body)
    if (campoFaltando) return res.status(400).json({ mensagem: `Campo obrigatório ausente: ${campoFaltando}` })

    // buscar setor do ADM
    const { data: adm, error: errAdm } = await supabase
      .from('funcionario')
      .select('id_setor')
      .eq('matricula_funcionario', matricula_adm)
      .maybeSingle()
    if (errAdm) return res.status(400).json({ mensagem: 'Erro ao buscar ADM', erro: errAdm })
    if (!adm) return res.status(400).json({ mensagem: 'Matrícula do ADM não encontrada' })

    // buscar funcionário
    const { data: funcionarioDesatualizado, error: errFunc } = await supabase
      .from('funcionario')
      .select('*')
      .eq('matricula_funcionario', matricula_funcionario)
      .maybeSingle()
    if (errFunc) return res.status(400).json({ mensagem: 'Erro ao buscar funcionário', erro: errFunc })
    if (!funcionarioDesatualizado) return res.status(404).json({ mensagem: 'Funcionário não encontrado' })

    // verificar setor do adm
    if (funcionarioDesatualizado.id_setor !== adm.id_setor) {
      return res.status(403).json({ mensagem: 'Funcionário não pertence ao setor do ADM' })
    }

    const isNumeric = (v) => typeof v === 'number' || (/^\d+$/.test(String(v).trim()))

    // --- tratar equipe: aceitar id ou nome; buscar lista limitada e pegar primeiro elemento ---
    if (equipe !== undefined && equipe !== null && String(equipe).trim() !== '') {
      if (isNumeric(equipe)) {
        const id = Number(equipe)
        const { data: eqById, error: errEqById } = await supabase
          .from('equipe')
          .select('id_equipe')
          .eq('id_equipe', id)
          .maybeSingle()
        if (errEqById) return res.status(502).json({ mensagem: 'Erro ao buscar equipe por id', erro: errEqById })
        if (!eqById) {
          return res.status(400).json({ mensagem: 'Equipe não encontrada por id. Cadastre a equipe antes de vincular ao funcionário.' })
        }
        equipe = eqById.id_equipe
      } else {
        // busca por nome -> retorna array limitado a 1 para evitar PGRST116
        const nome = String(equipe).trim()
        const { data: lista, error: errLista } = await supabase
          .from('equipe')
          .select('id_equipe, nome_equipe')
          .ilike('nome_equipe', nome)
          .limit(1)

        if (errLista) return res.status(502).json({ mensagem: 'Erro ao buscar equipe por nome', erro: errLista })
        if (!lista || lista.length === 0) {
          return res.status(400).json({ mensagem: 'Equipe não encontrada. Cadastre a equipe antes de vincular ao funcionário.' })
        }
        equipe = lista[0].id_equipe
      }
    }

    // --- tratar regiao: aceitar id ou nome; buscar lista limitada e pegar primeiro elemento / criar se necessário ---
    if (regiao !== undefined && regiao !== null && String(regiao).trim() !== '') {
      if (isNumeric(regiao)) {
        regiao = Number(regiao)
      } else {
        const nomeR = String(regiao).trim()
        const { data: listaRg, error: errRg } = await supabase
          .from('regiao')
          .select('id_regiao, nome_regiao')
          .ilike('nome_regiao', nomeR)
          .limit(1)

        if (errRg) return res.status(502).json({ mensagem: 'Erro ao buscar regiao por nome', erro: errRg })

        if (listaRg && listaRg.length > 0) {
          regiao = listaRg[0].id_regiao
        } else {
          const { data: novaReg, error: errCriar } = await supabase
            .from('regiao')
            .insert([{ nome_regiao: nomeR }])
            .select('id_regiao')
            .single()
          if (errCriar) return res.status(400).json({ mensagem: 'Erro ao criar regiao', erro: errCriar })
          regiao = novaReg.id_regiao
        }
      }
    }

    const payloadToUpdate = {
      email: email !== undefined ? email : funcionarioDesatualizado.email,
      telefone: telefone !== undefined ? telefone : funcionarioDesatualizado.telefone,
      cargo: cargo !== undefined ? cargo : funcionarioDesatualizado.cargo,
      id_equipe: equipe !== undefined ? equipe : funcionarioDesatualizado.id_equipe,
      id_regiao: regiao !== undefined ? regiao : funcionarioDesatualizado.id_regiao
    }

    const { data: funcionarioAtualizado, error: errUpdate } = await supabase
      .from('funcionario')
      .update(payloadToUpdate)
      .eq('matricula_funcionario', matricula_funcionario)
      .select('matricula_funcionario, nome, email, telefone, cargo, id_equipe, id_regiao')
      .maybeSingle()

    if (errUpdate) {
      console.error('Erro ao atualizar funcionário:', errUpdate)
      return res.status(400).json({ mensagem: 'Erro ao atualizar funcionário', erro: errUpdate })
    }

    await criarNotificacao({
      matricula_funcionario,
      tipo_notificacao: 'Atualização de Dados',
      mensagem: `Seus dados foram atualizados pelo ADM. Verifique as informações no sistema.`,
      matricula_responsavel: matricula_adm
    })

    return res.status(200).json({
      mensagem: 'Funcionário atualizado com sucesso',
      funcionario: funcionarioAtualizado
    })
  } catch (error) {
    console.error('Erro inesperado:', error)
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// Cadastrar escala e vincular ao funcionário
// POST /cadastrarEscala
route.post('/cadastrarEscala', async (req, res) => {
  const obrigatorios = ['matricula_adm', 'matricula_funcionario', 'data_inicio', 'tipo_escala']
  const campoFaltando = validarCampos(obrigatorios, req.body)
  if (campoFaltando)
    return res.status(400).json({ mensagem: `Preencha o campo obrigatório: ${campoFaltando}` })

  try {
    const {
      matricula_adm,
      matricula_funcionario,
      data_inicio,
      tipo_escala,
      dias_n_trabalhados_escala_semanal,
      usa_dias_especificos
    } = req.body

// Interpretar escala tipo NxM
const padrao = /^(\d{1,2})x(\d{1,2})$/
const match = tipo_escala.match(padrao)
if (!match)
  return res.status(400).json({ mensagem: 'Tipo de escala inválido' })

let n = parseInt(match[1], 10)
let m = parseInt(match[2], 10)

// Corrige tratamento de escalas em horas (ex: 12x36, 24x48, etc.)
//
// Lógica:
// - Se N ou M > 7 → assume-se que são horas.
// - A cada ciclo (N + M horas), calcula-se quantos dias o ciclo representa.
// - A partir disso, define-se 1 dia trabalhado para escalas de até 24h trabalhadas.
// - E calcula 1 dia de folga se a folga for >= 24h.
if (n > 7 || m > 7) {
  const cicloHoras = n + m
  const cicloDias = cicloHoras / 24

  // Se for uma escala horária curta (12x36, 24x48, etc.)
  // consideramos 1 dia trabalhado e 1 dia de folga por ciclo
  if (cicloDias <= 3) {
    n = 1
    m = 1
  } else {
    // Escalas mais longas (ex: 24x72 → 1x3)
    n = 1
    m = Math.round((m / n))
  }
}

// Verifica se precisa de dias específicos
const precisa_dias_especificos = usa_dias_especificos === 'SIM'

if (precisa_dias_especificos) {
  const diasArray = Array.isArray(dias_n_trabalhados_escala_semanal)
    ? dias_n_trabalhados_escala_semanal
    : []

  if (diasArray.length === 0)
    return res.status(400).json({ mensagem: 'Informe os dias específicos de folga.' })

  // Agora aceita nomes completos e abreviações
  const diasValidos = [
    'Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado',
    'Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'
  ]

  const diasInvalidos = diasArray.filter(d => !diasValidos.includes(d))
  if (diasInvalidos.length > 0)
    return res.status(400).json({ mensagem: `Dias inválidos: ${diasInvalidos.join(', ')}` })

  // Normaliza abreviações (opcional)
  const mapDias = {
    Dom: 'Domingo', Seg: 'Segunda', Ter: 'Terça', Qua: 'Quarta',
    Qui: 'Quinta', Sex: 'Sexta', Sab: 'Sábado'
  }
  const diasNormalizados = diasArray.map(d => mapDias[d] || d)

  if (diasNormalizados.length !== m)
    return res.status(400).json({
      mensagem: `Quantidade de dias não trabalhados (${m}) difere dos dias informados (${diasNormalizados.length}).`
    })
}


    // Verificar funcionário
    const { data: funcionarioExistente } = await supabase
      .from('funcionario')
      .select('*')
      .eq('matricula_funcionario', matricula_funcionario)
      .maybeSingle()
    if (!funcionarioExistente)
      return res.status(400).json({ mensagem: 'Funcionário não encontrado' })

    // verificar se funcionario ja possui escala
    if (funcionarioExistente.id_escala) {
      return res.status(400).json({ mensagem: 'Funcionário já possui uma escala vinculada' })
    }

    // Inserir escala
    const { data: escalaCriada, error: errorEscala } = await supabase
      .from('escala')
      .insert([
        {
          data_inicio,
          tipo_escala,
          dias_trabalhados: n,
          dias_n_trabalhados: m,
          dias_n_trabalhados_escala_semanal: precisa_dias_especificos
            ? dias_n_trabalhados_escala_semanal
            : null
        }
      ])
      .select()
      .single()

    if (errorEscala) {
      return res.status(400).json({ mensagem: 'Erro ao inserir escala', erro: errorEscala })
    }

    // Vincular escala ao funcionário
    const { error: errorVinculo } = await supabase
      .from('funcionario')
      .update({ id_escala: escalaCriada.id_escala })
      .eq('matricula_funcionario', matricula_funcionario)

    if (errorVinculo) {
      return res
        .status(400)
        .json({ mensagem: 'Erro ao vincular escala ao funcionário', erro: errorVinculo })
    }

    // notificar criação de escala
    await criarNotificacao({
      matricula_funcionario,
      tipo_notificacao: 'Nova Escala',
      mensagem: `Sua nova escala foi cadastrada: Início em ${data_inicio}, Tipo: ${tipo_escala}. Por favor, confirme o recebimento da escala no sistema.`,
      matricula_responsavel: matricula_adm
    })

    // confirmacao

    const { data: confirmacaoCriada, error: errorConfirmacao } = await supabase
      .from('escala_confirmacao')
      .insert([
        {
          matricula_funcionario: funcionarioExistente.matricula_funcionario,
          id_escala: escalaCriada.id_escala
        }
      ])
      .select('*')
      .single()

    if (errorConfirmacao) {
      console.error('Erro ao criar confirmação da escala:', errorConfirmacao)
      // opcional: desfazer escala criada ou retornar erro
      return res.status(400).json({ mensagem: 'Erro ao criar confirmação da escala', erro: errorConfirmacao })
    }

    // Vincular o id da confirmação (id_confirmacao) ao funcionário
    const { error: errorVinculoConfirm } = await supabase
      .from('funcionario')
      .update({ id_confirmacao: confirmacaoCriada.id_confirmacao })
      .eq('matricula_funcionario', funcionarioExistente.matricula_funcionario)

    if (errorVinculoConfirm) {
      console.error('Erro ao vincular confirmação ao funcionário:', errorVinculoConfirm)
      // não interromper necessariamente, mas informar
    }

    return res.status(201).json({ mensagem: 'Escala cadastrada com sucesso', escala: escalaCriada })
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// PUT /alterarEscala
route.put('/alterarEscala', async (req, res) => {
  const obrigatorios = ['matricula_adm', 'matricula_funcionario', 'data_inicio', 'tipo_escala']
  const campoFaltando = validarCampos(obrigatorios, req.body)
  if (campoFaltando)
    return res.status(400).json({ mensagem: `Preencha o campo obrigatório: ${campoFaltando}` })

  try {
    const {
      matricula_adm,
      matricula_funcionario,
      data_inicio,
      tipo_escala,
      dias_n_trabalhados_escala_semanal,
      usa_dias_especificos
    } = req.body

    // Interpretar escala tipo NxM
const padrao = /^(\d{1,2})x(\d{1,2})$/
const match = tipo_escala.match(padrao)
if (!match)
  return res.status(400).json({ mensagem: 'Tipo de escala inválido' })

let n = parseInt(match[1], 10)
let m = parseInt(match[2], 10)

// Corrige tratamento de escalas em horas (ex: 12x36, 24x48, etc.)
//
// Lógica:
// - Se N ou M > 7 → assume-se que são horas.
// - A cada ciclo (N + M horas), calcula-se quantos dias o ciclo representa.
// - A partir disso, define-se 1 dia trabalhado para escalas de até 24h trabalhadas.
// - E calcula 1 dia de folga se a folga for >= 24h.
if (n > 7 || m > 7) {
  const cicloHoras = n + m
  const cicloDias = cicloHoras / 24

  // Se for uma escala horária curta (12x36, 24x48, etc.)
  // consideramos 1 dia trabalhado e 1 dia de folga por ciclo
  if (cicloDias <= 3) {
    n = 1
    m = 1
  } else {
    // Escalas mais longas (ex: 24x72 → 1x3)
    n = 1
    m = Math.round((m / n))
  }
}

// Verifica se precisa de dias específicos
const precisa_dias_especificos = usa_dias_especificos === 'SIM'

if (precisa_dias_especificos) {
  const diasArray = Array.isArray(dias_n_trabalhados_escala_semanal)
    ? dias_n_trabalhados_escala_semanal
    : []

  if (diasArray.length === 0)
    return res.status(400).json({ mensagem: 'Informe os dias específicos de folga.' })

  // Agora aceita nomes completos e abreviações
  const diasValidos = [
    'Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado',
    'Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'
  ]

  const diasInvalidos = diasArray.filter(d => !diasValidos.includes(d))
  if (diasInvalidos.length > 0)
    return res.status(400).json({ mensagem: `Dias inválidos: ${diasInvalidos.join(', ')}` })

  // Normaliza abreviações (opcional)
  const mapDias = {
    Dom: 'Domingo', Seg: 'Segunda', Ter: 'Terça', Qua: 'Quarta',
    Qui: 'Quinta', Sex: 'Sexta', Sab: 'Sábado'
  }
  const diasNormalizados = diasArray.map(d => mapDias[d] || d)

  if (diasNormalizados.length !== m)
    return res.status(400).json({
      mensagem: `Quantidade de dias não trabalhados (${m}) difere dos dias informados (${diasNormalizados.length}).`
    })
}


    // Verificar funcionário e setor
    const { data: funcionarioExistente } = await supabase
      .from('funcionario')
      .select('*')
      .eq('matricula_funcionario', matricula_funcionario)
      .maybeSingle()
    if (!funcionarioExistente)
      return res.status(400).json({ mensagem: 'Funcionário não encontrado' })
    if (!funcionarioExistente.id_escala)
      return res.status(400).json({ mensagem: 'Funcionário não possui escala vinculada' })

    // Alterar escala
    const { data: escalaAtualizada, error } = await supabase
      .from('escala')
      .update({
        data_inicio,
        tipo_escala,
        dias_trabalhados: n,
        dias_n_trabalhados: m,
        dias_n_trabalhados_escala_semanal: precisa_dias_especificos
          ? dias_n_trabalhados_escala_semanal
          : [],
        usa_dias_especificos: precisa_dias_especificos
      })
      .eq('id_escala', funcionarioExistente.id_escala)
      .select()
      .single()

    if (error) {
      return res.status(400).json({ mensagem: 'Erro ao atualizar escala', erro: error })
    }

    // notificar alteração de escala
    await criarNotificacao({
      matricula_funcionario,
      tipo_notificacao: 'Atualização de Escala',
      mensagem: `Sua escala foi atualizada: Início em ${data_inicio}, Tipo: ${tipo_escala}. Por favor, confirme o recebimento da escala no sistema.`,
      matricula_responsavel: matricula_adm
    })

    // confirmacao

    // remover confirmação antiga (se existir) associada à escala anterior do funcionário
    if (funcionarioExistente.id_escala) {
      const { error: errorDeletar } = await supabase
        .from('escala_confirmacao')
        .delete()
        .eq('id_escala', funcionarioExistente.id_escala)
        .eq('matricula_funcionario', funcionarioExistente.matricula_funcionario)

      if (errorDeletar) {
        console.error('Erro ao deletar confirmação antiga:', errorDeletar)
      }
    }

    // criar nova confirmação para a escala atualizada
    const { data: confirmacaoCriada, error: errorConfirmacao } = await supabase
      .from('escala_confirmacao')
      .insert([
        {
          matricula_funcionario: funcionarioExistente.matricula_funcionario,
          id_escala: escalaAtualizada.id_escala
        }
      ])
      .select('*')
      .single()

    if (errorConfirmacao) {
      console.error('Erro ao criar confirmação da escala atualizada:', errorConfirmacao)
      return res.status(400).json({ mensagem: 'Erro ao criar confirmação da escala', erro: errorConfirmacao })
    }

    // atualizar o funcionário para apontar para a nova confirmação (usar id_confirmacao retornado)
    const { error: errorAtualizarFunc } = await supabase
      .from('funcionario')
      .update({ id_confirmacao: confirmacaoCriada.id_confirmacao })
      .eq('matricula_funcionario', funcionarioExistente.matricula_funcionario)

    if (errorAtualizarFunc) {
      console.error('Erro ao atualizar funcionário com nova confirmação:', errorAtualizarFunc)
    }

    return res
      .status(200)
      .json({ mensagem: 'Escala alterada com sucesso', escala: escalaAtualizada })
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// cadastrar turno e vincular ao funcionário
route.post('/cadastrarTurno', async (req, res) => {
  try {
    const obrigatorios = [
      'matricula_adm',
      'matricula_funcionario',
      'inicio_turno',
      'termino_turno',
      'duracao_turno',
      'intervalo_turno'
    ]
    const campoFaltando = validarCampos(obrigatorios, req.body)
    if (campoFaltando) {
      return res.status(400).json({ mensagem: `Preencha o campo obrigatório: ${campoFaltando}` })
    }

    const {
      matricula_adm,
      matricula_funcionario,
      inicio_turno,
      termino_turno,
      duracao_turno,
      intervalo_turno
    } = req.body

    // Verificar se funcionário existe
    const { data: funcionarioExistente, error: errorFuncionario } = await supabase
      .from('funcionario')
      .select('*')
      .eq('matricula_funcionario', matricula_funcionario)
      .maybeSingle()

    if (errorFuncionario) {
      return res
        .status(400)
        .json({ mensagem: 'Erro ao buscar funcionário', erro: errorFuncionario })
    }
    if (!funcionarioExistente) {
      return res.status(400).json({ mensagem: 'Matrícula do funcionário não encontrada' })
    }

    // garantir que o funcionario possua escala antes de buscar turnos
    if (!funcionarioExistente.id_escala) {
      return res.status(400).json({
        mensagem:
          'Funcionário não possui escala vinculada. Cadastre uma escala antes de adicionar um turno.'
      })
    }

    // verificar se o funcionario já possui um turno vinculado
    if (funcionarioExistente.id_turno) {
      return res.status(400).json({ mensagem: 'Funcionário já possui um turno vinculado' })
    }

    // Inserir turno
    const { data: turnoCriado, error: errorTurno } = await supabase
      .from('turno')
      .insert([{ inicio_turno, termino_turno, duracao_turno, intervalo_turno }])
      .select('*')
      .single()

    if (errorTurno) {
      return res.status(400).json({ mensagem: 'Erro ao inserir turno', erro: errorTurno })
    }

    // Vincular turno criado ao funcionário
    const { data: turnoVinculado, error: errorVinculo } = await supabase
      .from('funcionario')
      .update({ id_turno: turnoCriado.id_turno })
      .eq('matricula_funcionario', matricula_funcionario)
      .select('*')
      .single()

    if (errorVinculo) {
      return res
        .status(400)
        .json({ mensagem: 'Erro ao vincular turno ao funcionário!', erro: errorVinculo })
    }

    // notificar criação de turno
    await criarNotificacao({
      matricula_funcionario,
      tipo_notificacao: 'Novo Turno',
      mensagem: `Seu novo turno foi cadastrado: ${inicio_turno} - ${termino_turno}. Por favor, confirme o recebimento do turno no sistema.`,
      matricula_responsavel: matricula_adm
    })

    res.status(201).json({
      mensagem: 'Turno cadastrado e vinculado com sucesso',
      turno: turnoCriado,
      funcionario: turnoVinculado
    })
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

route.put('/alterarTurno', async (req, res) => {
  try {
    const obrigatorios = [
      'matricula_adm',
      'matricula_funcionario',
      'inicio_turno',
      'termino_turno',
      'duracao_turno',
      'intervalo_turno'
    ]
    const campoFaltando = validarCampos(obrigatorios, req.body)
    if (campoFaltando) {
      return res.status(400).json({ mensagem: `Preencha o campo obrigatório: ${campoFaltando}` })
    }

    const {
      matricula_adm,
      matricula_funcionario,
      inicio_turno,
      termino_turno,
      duracao_turno,
      intervalo_turno
    } = req.body

    // Verificar se funcionário existe
    const { data: funcionarioExistente, error: errorFuncionario } = await supabase
      .from('funcionario')
      .select('*')
      .eq('matricula_funcionario', matricula_funcionario)
      .maybeSingle()

    if (errorFuncionario) {
      return res
        .status(400)
        .json({ mensagem: 'Erro ao buscar funcionário', erro: errorFuncionario })
    }
    if (!funcionarioExistente) {
      return res.status(400).json({ mensagem: 'Matrícula do funcionário não encontrada' })
    }

    // garantir que o funcionario possua turno antes de alterar
    if (!funcionarioExistente.id_turno) {
      return res.status(400).json({
        mensagem:
          'Funcionário não possui turno vinculado. Cadastre um turno antes de tentar alterá-lo.'
      })
    }

    // Alterar turno
    const { data: turnoAtualizado, error: errorTurno } = await supabase
      .from('turno')
      .update({ inicio_turno, termino_turno, duracao_turno, intervalo_turno })
      .eq('id_turno', funcionarioExistente.id_turno)
      .select('*')
      .single()

    if (errorTurno) {
      return res.status(400).json({ mensagem: 'Erro ao alterar turno', erro: errorTurno })
    }

    // notificar alteração de turno
    await criarNotificacao({
      matricula_funcionario,
      tipo_notificacao: 'Atualização de Turno',
      mensagem: `Seu turno foi atualizado: ${inicio_turno} - ${termino_turno}. Por favor, confirme o recebimento do turno no sistema.`,
      matricula_responsavel: matricula_adm
    })

    res.status(200).json({
      mensagem: 'Turno alterado com sucesso',
      turno: turnoAtualizado
    })
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

// cadastrar equipe
route.post('/cadastrarEquipe/:matricula_adm', async (req, res) => {
  try {
    const { matricula_adm } = req.params
    const obrigatorios = ['nome_equipe']

    const campoFaltando = validarCampos(obrigatorios, req.body)
    if (campoFaltando) {
      return res.status(400).json({ mensagem: `Preencha o campo obrigatório: ${campoFaltando}` })
    }

    const { nome_equipe } = req.body

    // Verificar se equipe já existe no setor do adm
    const { data: adm } = await supabase
      .from('funcionario')
      .select('id_setor')
      .eq('matricula_funcionario', matricula_adm)
      .maybeSingle()

    if (!adm) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM não encontrada' })
    }

    const { data: equipeExistente, error: errorEquipeExistente } = await supabase
      .from('equipe')
      .select('*')
      .eq('nome_equipe', nome_equipe)
      .eq('id_setor', adm.id_setor)
      .maybeSingle()

    if (errorEquipeExistente) {
      return res.status(400).json({ mensagem: 'Erro ao buscar equipe', erro: errorEquipeExistente })
    }
    if (equipeExistente) {
      return res.status(400).json({ mensagem: 'Equipe já existe neste setor' })
    }

    // Inserir equipe
    const { data: novaEquipe, error: errorNovaEquipe } = await supabase
      .from('equipe')
      .insert([{ nome_equipe, id_setor: adm.id_setor }])
      .select('*')
      .single()

    if (errorNovaEquipe) {
      return res.status(400).json({ mensagem: 'Erro ao inserir equipe', erro: errorNovaEquipe })
    }

    res.status(201).json({ mensagem: 'Equipe cadastrada com sucesso', equipe: novaEquipe })
  } catch (error) {
    return res.status(500).json({ mensagem: 'Erro no servidor', erro: error.message })
  }
})

route.post('/cadastrarDiaEspecifico/:matricula_adm', async (req, res) => {
  try {
    const { matricula_adm } = req.params

    const obrigatorios = ['matricula_funcionario', 'nome_diae', 'data_diae', 'descricao_diae']
    const campoFaltando = validarCampos(obrigatorios, req.body)

    if (campoFaltando) {
      return res.status(400).json({
        mensagem: `Preencha o campo obrigatório: ${campoFaltando}`
      })
    }

    const { matricula_funcionario, nome_diae, data_diae, descricao_diae } = req.body

    // verifica se já existe um dia específico cadastrado na mesma data para o mesmo funcionário
    const { data: diaExistente, error: errorCheck } = await supabase
      .from('dias_especificos')
      .select('*')
      .eq('matricula_funcionario', matricula_funcionario)
      .eq('data_diae', data_diae)
      .maybeSingle()

    if (errorCheck) {
      return res.status(400).json({
        mensagem: 'Erro ao verificar existência de dia específico',
        erro: errorCheck.message
      })
    }

    if (diaExistente) {
      return res.status(409).json({
        mensagem: 'Já existe um dia específico cadastrado para este funcionário nesta data'
      })
    }

    // insere o novo dia específico
    const { data: diaEspecifico, error } = await supabase
      .from('dias_especificos')
      .insert([{
        matricula_funcionario,
        nome_diae,
        data_diae,
        descricao_diae
      }])
      .select('*')
      .single()

    if (error) {
      return res.status(400).json({
        mensagem: 'Erro ao inserir dia específico',
        erro: error.message
      })
    }

    // notificar funcionário sobre o novo dia específico
    await criarNotificacao({
      matricula_funcionario,
      tipo_notificacao: 'Novo Dia Específico',
      mensagem: `Um novo dia específico foi adicionado: ${nome_diae} (${data_diae}). Verifique os detalhes no sistema.`,
      matricula_responsavel: matricula_adm
    })

    return res.status(201).json({
      mensagem: 'Dia específico criado com sucesso e notificação enviada',
      diaEspecifico
    })

  } catch (err) {
    return res.status(500).json({
      mensagem: 'Erro no servidor',
      erro: err.message
    })
  }
})


// RELATÓRIO GERAL DO SETOR
route.get('/relatorioGeralSetor/:matricula_adm', async (req, res) => {
  try {
    const { matricula_adm } = req.params
    const { mes, ano } = req.query

    if (!mes || !ano) {
      return res.status(400).json({ 
        mensagem: 'Mês e ano são obrigatórios. Use ?mes=1&ano=2024' 
      })
    }

    const mesNum = parseInt(mes)
    const anoNum = parseInt(ano)

    if (mesNum < 1 || mesNum > 12) {
      return res.status(400).json({ mensagem: 'Mês inválido (use 1-12)' })
    }

    // Buscar setor do ADM
    const { data: adm, error: errorAdm } = await supabase
      .from('funcionario')
      .select('id_setor, nome, setor(nome_setor)')
      .eq('matricula_funcionario', matricula_adm)
      .maybeSingle()

    if (errorAdm || !adm) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM não encontrada' })
    }

    // Buscar todas as equipes do setor
    const { data: equipes } = await supabase
      .from('equipe')
      .select('id_equipe, nome_equipe')
      .eq('id_setor', adm.id_setor)

    // Buscar todos os funcionários do setor
    const { data: funcionarios } = await supabase
      .from('funcionario')
      .select(`
        matricula_funcionario, nome, email, telefone, cargo,
        equipe(nome_equipe),
        regiao(nome_regiao),
        escala(tipo_escala, data_inicio, dias_trabalhados, dias_n_trabalhados),
        turno(inicio_turno, termino_turno, duracao_turno)
      `)
      .eq('id_setor', adm.id_setor)
      .neq('matricula_funcionario', matricula_adm)

    // Buscar dias específicos do mês
    const primeiroDia = `${anoNum}-${String(mesNum).padStart(2, '0')}-01`
    const ultimoDia = new Date(anoNum, mesNum, 0).getDate()
    const ultimoDiaFormatado = `${anoNum}-${String(mesNum).padStart(2, '0')}-${ultimoDia}`

    const { data: diasEspecificos } = await supabase
      .from('dias_especificos')
      .select(`
        matricula_funcionario,
        nome_diae,
        data_diae,
        descricao_diae,
        funcionario(nome)
      `)
      .gte('data_diae', primeiroDia)
      .lte('data_diae', ultimoDiaFormatado)
      .in('matricula_funcionario', funcionarios.map(f => f.matricula_funcionario))

    // Criar PDF
    const doc = new PDFDocument({ margin: 50 })
    
    // Configurar headers para download
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition', 
      `attachment; filename=relatorio_setor_${mesNum}_${anoNum}.pdf`
    )

    doc.pipe(res)

    // Cabeçalho
    adicionarCabecalho(
      doc,
      'RELATÓRIO GERAL DO SETOR',
      `${adm.setor?.nome_setor || 'Setor'} - ${obterNomeMes(mesNum)}/${anoNum}`
    )

    // Informações gerais
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Informações Gerais', { underline: true })
      .moveDown(0.5)
      .fontSize(10)
      .font('Helvetica')
      .text(`Administrador: ${adm.nome}`)
      .text(`Total de Equipes: ${equipes?.length || 0}`)
      .text(`Total de Funcionários: ${funcionarios?.length || 0}`)
      .moveDown(1)

    // Resumo por equipe
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Resumo por Equipe', { underline: true })
      .moveDown(0.5)

    for (const equipe of equipes || []) {
      const funcsEquipe = funcionarios.filter(f => f.equipe?.nome_equipe === equipe.nome_equipe)
      
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .text(`${equipe.nome_equipe}:`, { continued: true })
        .font('Helvetica')
        .text(` ${funcsEquipe.length} funcionário(s)`)
        .fontSize(10)
      
      funcsEquipe.forEach(func => {
        doc.text(`  • ${func.nome} (${func.matricula_funcionario})`)
      })
      
      doc.moveDown(0.5)
    }

    doc.moveDown(1)

    // Escalas ativas
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Escalas Ativas', { underline: true })
      .moveDown(0.5)
      .fontSize(10)
      .font('Helvetica')

    const funcComEscala = funcionarios.filter(f => f.escala)
    
    if (funcComEscala.length > 0) {
      funcComEscala.forEach(func => {
        doc
          .font('Helvetica-Bold')
          .text(`${func.nome}:`, { continued: true })
          .font('Helvetica')
          .text(` ${func.escala.tipo_escala} (${func.escala.dias_trabalhados}x${func.escala.dias_n_trabalhados})`)
      })
    } else {
      doc.text('Nenhuma escala cadastrada no período')
    }

    doc.moveDown(1)

    // Dias específicos do mês
    if (diasEspecificos && diasEspecificos.length > 0) {
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .text('Dias Específicos do Mês', { underline: true })
        .moveDown(0.5)
        .fontSize(10)
        .font('Helvetica')

      diasEspecificos.forEach(dia => {
        doc
          .font('Helvetica-Bold')
          .text(`${formatarData(dia.data_diae)} - ${dia.nome_diae}`, { continued: true })
          .font('Helvetica')
          .text(` (${dia.funcionario?.nome || 'N/A'})`)
          .text(`  ${dia.descricao_diae}`)
          .moveDown(0.3)
      })
    }

    doc.end()

  } catch (error) {
    return res.status(500).json({ 
      mensagem: 'Erro ao gerar relatório', 
      erro: error.message 
    })
  }
})

// RELATÓRIO POR EQUIPE
route.get('/relatorioPorEquipe/:matricula_adm/:id_equipe', async (req, res) => {
  try {
    const { matricula_adm, id_equipe } = req.params
    const { mes, ano } = req.query

    if (!mes || !ano) {
      return res.status(400).json({ 
        mensagem: 'Mês e ano são obrigatórios. Use ?mes=1&ano=2024' 
      })
    }

    const mesNum = parseInt(mes)
    const anoNum = parseInt(ano)

    // Buscar informações da equipe
    const { data: equipe } = await supabase
      .from('equipe')
      .select('nome_equipe, id_setor, setor(nome_setor)')
      .eq('id_equipe', id_equipe)
      .single()

    if (!equipe) {
      return res.status(404).json({ mensagem: 'Equipe não encontrada' })
    }

    // Buscar funcionários da equipe
    const { data: funcionarios } = await supabase
      .from('funcionario')
      .select(`
        matricula_funcionario, nome, email, telefone, cargo,
        regiao(nome_regiao),
        escala(tipo_escala, data_inicio, dias_trabalhados, dias_n_trabalhados, dias_n_trabalhados_escala_semanal),
        turno(inicio_turno, termino_turno, duracao_turno, intervalo_turno)
      `)
      .eq('id_equipe', id_equipe)
      .order('nome', { ascending: true })

    // Buscar dias específicos
    const primeiroDia = `${anoNum}-${String(mesNum).padStart(2, '0')}-01`
    const ultimoDia = new Date(anoNum, mesNum, 0).getDate()
    const ultimoDiaFormatado = `${anoNum}-${String(mesNum).padStart(2, '0')}-${ultimoDia}`

    const { data: diasEspecificos } = await supabase
      .from('dias_especificos')
      .select('*')
      .gte('data_diae', primeiroDia)
      .lte('data_diae', ultimoDiaFormatado)
      .in('matricula_funcionario', funcionarios.map(f => f.matricula_funcionario))

    // Criar PDF
    const doc = new PDFDocument({ margin: 50 })
    
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition', 
      `attachment; filename=relatorio_equipe_${id_equipe}_${mesNum}_${anoNum}.pdf`
    )

    doc.pipe(res)

    // Cabeçalho
    adicionarCabecalho(
      doc,
      'RELATÓRIO POR EQUIPE',
      `${equipe.nome_equipe} - ${obterNomeMes(mesNum)}/${anoNum}`
    )

    // Informações da equipe
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Informações da Equipe', { underline: true })
      .moveDown(0.5)
      .fontSize(10)
      .font('Helvetica')
      .text(`Setor: ${equipe.setor?.nome_setor || 'N/A'}`)
      .text(`Total de Funcionários: ${funcionarios?.length || 0}`)
      .moveDown(1)

    // Lista de funcionários
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Funcionários', { underline: true })
      .moveDown(0.5)

    for (const func of funcionarios || []) {
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .text(`${func.nome} (${func.matricula_funcionario})`)
        .fontSize(10)
        .font('Helvetica')
        .text(`Cargo: ${func.cargo || 'Não informado'}`)
        .text(`Email: ${func.email || 'Não informado'}`)
        .text(`Telefone: ${func.telefone || 'Não informado'}`)
        .text(`Região: ${func.regiao?.nome_regiao || 'Não informada'}`)

      if (func.escala) {
        doc.text(
          `Escala: ${func.escala.tipo_escala} (${func.escala.dias_trabalhados} dias ON / ${func.escala.dias_n_trabalhados} dias OFF)`
        )
        
        if (func.escala.dias_n_trabalhados_escala_semanal) {
          const dias = Array.isArray(func.escala.dias_n_trabalhados_escala_semanal) 
            ? func.escala.dias_n_trabalhados_escala_semanal.join(', ')
            : func.escala.dias_n_trabalhados_escala_semanal
          doc.text(`Folgas semanais: ${dias}`)
        }
      } else {
        doc.text('Escala: Não cadastrada')
      }

      if (func.turno) {
        doc.text(
          `Turno: ${func.turno.inicio_turno} às ${func.turno.termino_turno} (${func.turno.duracao_turno}h)`
        )
      } else {
        doc.text('Turno: Não cadastrado')
      }

      // Dias específicos do funcionário no mês
      const diasFunc = diasEspecificos?.filter(d => d.matricula_funcionario === func.matricula_funcionario)
      if (diasFunc && diasFunc.length > 0) {
        doc
          .font('Helvetica-Bold')
          .text('Dias Específicos:')
          .font('Helvetica')
        
        diasFunc.forEach(dia => {
          doc.text(`  • ${formatarData(dia.data_diae)} - ${dia.nome_diae}: ${dia.descricao_diae}`)
        })
      }

      doc.moveDown(1)

      // Adicionar nova página se necessário
      if (doc.y > 700) {
        doc.addPage()
      }
    }

    doc.end()

  } catch (error) {
    return res.status(500).json({ 
      mensagem: 'Erro ao gerar relatório', 
      erro: error.message 
    })
  }
})

// RELATÓRIO POR FUNCIONÁRIO
route.get('/relatorioPorFuncionario/:matricula_adm/:matricula_funcionario', async (req, res) => {
  try {
    const { matricula_adm, matricula_funcionario } = req.params
    const { mes, ano } = req.query

    if (!mes || !ano) {
      return res.status(400).json({ 
        mensagem: 'Mês e ano são obrigatórios. Use ?mes=1&ano=2024' 
      })
    }

    const mesNum = parseInt(mes)
    const anoNum = parseInt(ano)

    // Buscar setor do ADM
    const { data: adm } = await supabase
      .from('funcionario')
      .select('id_setor')
      .eq('matricula_funcionario', matricula_adm)
      .maybeSingle()

    if (!adm) {
      return res.status(400).json({ mensagem: 'Matrícula do ADM não encontrada' })
    }

    // Buscar funcionário completo
    const { data: funcionario } = await supabase
      .from('funcionario')
      .select(`
        matricula_funcionario, nome, email, telefone, cargo,
        equipe(nome_equipe),
        regiao(nome_regiao),
        setor(nome_setor),
        escala(
          id_escala, tipo_escala, data_inicio, 
          dias_trabalhados, dias_n_trabalhados, 
          dias_n_trabalhados_escala_semanal
        ),
        turno(inicio_turno, termino_turno, duracao_turno, intervalo_turno),
        escala_confirmacao:escala_confirmacao!escala_confirmacao_matricula_funcionario_fkey(
          id_confirmacao, data_confirmacao, status
        )
      `)
      .eq('matricula_funcionario', matricula_funcionario)
      .eq('id_setor', adm.id_setor)
      .maybeSingle()

    if (!funcionario) {
      return res.status(404).json({ 
        mensagem: 'Funcionário não encontrado ou não pertence ao setor do ADM' 
      })
    }

    // Buscar dias específicos do funcionário no mês
    const primeiroDia = `${anoNum}-${String(mesNum).padStart(2, '0')}-01`
    const ultimoDia = new Date(anoNum, mesNum, 0).getDate()
    const ultimoDiaFormatado = `${anoNum}-${String(mesNum).padStart(2, '0')}-${ultimoDia}`

    const { data: diasEspecificos } = await supabase
      .from('dias_especificos')
      .select('*')
      .eq('matricula_funcionario', matricula_funcionario)
      .gte('data_diae', primeiroDia)
      .lte('data_diae', ultimoDiaFormatado)
      .order('data_diae', { ascending: true })

    // Calcular dias trabalhados no mês (baseado na escala)
    let diasTrabalhados = 0
    let diasFolga = 0
    
    if (funcionario.escala) {
      const inicioMes = new Date(anoNum, mesNum - 1, 1)
      const fimMes = new Date(anoNum, mesNum, 0)
      const inicioEscala = new Date(funcionario.escala.data_inicio)
      
      for (let d = new Date(inicioMes); d <= fimMes; d.setDate(d.getDate() + 1)) {
        if (d >= inicioEscala) {
          const diffDias = Math.floor((d - inicioEscala) / (1000 * 60 * 60 * 24))
          const ciclo = funcionario.escala.dias_trabalhados + funcionario.escala.dias_n_trabalhados
          const posicao = diffDias % ciclo
          
          // Verificar folgas semanais específicas
          let isFolgaSemanal = false
          if (funcionario.escala.dias_n_trabalhados_escala_semanal) {
            const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']
            const diaSemana = diasSemana[d.getDay()].toLowerCase()
            
            let diasFolgaSemanal = funcionario.escala.dias_n_trabalhados_escala_semanal
            if (typeof diasFolgaSemanal === 'string') {
              try {
                diasFolgaSemanal = JSON.parse(diasFolgaSemanal)
              } catch (e) {
                diasFolgaSemanal = []
              }
            }
            
            if (Array.isArray(diasFolgaSemanal)) {
              isFolgaSemanal = diasFolgaSemanal.some(
                df => String(df).toLowerCase() === diaSemana
              )
            }
          }
          
          if (isFolgaSemanal || posicao >= funcionario.escala.dias_trabalhados) {
            diasFolga++
          } else {
            diasTrabalhados++
          }
        }
      }
    }

    // Criar PDF
    const doc = new PDFDocument({ margin: 50 })
    
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition', 
      `attachment; filename=relatorio_funcionario_${matricula_funcionario}_${mesNum}_${anoNum}.pdf`
    )

    doc.pipe(res)

    // Cabeçalho
    adicionarCabecalho(
      doc,
      'RELATÓRIO INDIVIDUAL DO FUNCIONÁRIO',
      `${obterNomeMes(mesNum)}/${anoNum}`
    )

    // Dados pessoais
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Dados Pessoais', { underline: true })
      .moveDown(0.5)
      .fontSize(10)
      .font('Helvetica')
      .text(`Nome: ${funcionario.nome}`)
      .text(`Matrícula: ${funcionario.matricula_funcionario}`)
      .text(`Email: ${funcionario.email || 'Não informado'}`)
      .text(`Telefone: ${funcionario.telefone || 'Não informado'}`)
      .text(`Cargo: ${funcionario.cargo || 'Não informado'}`)
      .moveDown(1)

    // Dados organizacionais
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Dados Organizacionais', { underline: true })
      .moveDown(0.5)
      .fontSize(10)
      .font('Helvetica')
      .text(`Setor: ${funcionario.setor?.nome_setor || 'Não informado'}`)
      .text(`Equipe: ${funcionario.equipe?.nome_equipe || 'Não informada'}`)
      .text(`Região: ${funcionario.regiao?.nome_regiao || 'Não informada'}`)
      .moveDown(1)

    // Escala
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Informações da Escala', { underline: true })
      .moveDown(0.5)
      .fontSize(10)
      .font('Helvetica')

    if (funcionario.escala) {
      doc
        .text(`Tipo: ${funcionario.escala.tipo_escala}`)
        .text(`Data de início: ${formatarData(funcionario.escala.data_inicio)}`)
        .text(`Dias trabalhados: ${funcionario.escala.dias_trabalhados}`)
        .text(`Dias de folga: ${funcionario.escala.dias_n_trabalhados}`)
      
      if (funcionario.escala.dias_n_trabalhados_escala_semanal) {
        const dias = Array.isArray(funcionario.escala.dias_n_trabalhados_escala_semanal)
          ? funcionario.escala.dias_n_trabalhados_escala_semanal.join(', ')
          : funcionario.escala.dias_n_trabalhados_escala_semanal
        doc.text(`Folgas semanais fixas: ${dias}`)
      }

      // Confirmação da escala
      if (funcionario.escala_confirmacao && Array.isArray(funcionario.escala_confirmacao)) {
        const confirmacao = funcionario.escala_confirmacao[0]
        if (confirmacao) {
          doc
            .font('Helvetica-Bold')
            .text('Status de Confirmação:', { continued: true })
            .font('Helvetica')
            .text(` ${confirmacao.status || 'Pendente'}`)
          
          if (confirmacao.data_confirmacao) {
            doc.text(`Data da confirmação: ${formatarData(confirmacao.data_confirmacao)}`)
          }
        }
      }
    } else {
      doc.text('Escala não cadastrada')
    }

    doc.moveDown(1)

    // Turno
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Informações do Turno', { underline: true })
      .moveDown(0.5)
      .fontSize(10)
      .font('Helvetica')

    if (funcionario.turno) {
      doc
        .text(`Início: ${funcionario.turno.inicio_turno}`)
        .text(`Término: ${funcionario.turno.termino_turno}`)
        .text(`Duração: ${funcionario.turno.duracao_turno} horas`)
        .text(`Intervalo: ${funcionario.turno.intervalo_turno} minutos`)
    } else {
      doc.text('Turno não cadastrado')
    }

    doc.moveDown(1)

    // Estatísticas do mês
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text(`Estatísticas de ${obterNomeMes(mesNum)}/${anoNum}`, { underline: true })
      .moveDown(0.5)
      .fontSize(10)
      .font('Helvetica')
      .text(`Dias trabalhados: ${diasTrabalhados}`)
      .text(`Dias de folga: ${diasFolga}`)
      .text(`Dias específicos cadastrados: ${diasEspecificos?.length || 0}`)
      .moveDown(1)

    // Dias específicos
    if (diasEspecificos && diasEspecificos.length > 0) {
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .text('Dias Específicos do Mês', { underline: true })
        .moveDown(0.5)
        .fontSize(10)
        .font('Helvetica')

      diasEspecificos.forEach(dia => {
        doc
          .font('Helvetica-Bold')
          .text(`${formatarData(dia.data_diae)} - ${dia.nome_diae}`)
          .font('Helvetica')
          .text(`${dia.descricao_diae}`)
          .moveDown(0.5)
      })
    }

    doc.end()

  } catch (error) {
    return res.status(500).json({ 
      mensagem: 'Erro ao gerar relatório', 
      erro: error.message 
    })
  }
})

export default route
