'use strict'

const every = require('lodash/every')
const clone = require('lodash/clone')
const isArray = require('lodash/isArray')
const remove = require('lodash/remove')
const isEmpty = require('lodash/isEmpty')
const pick = require('lodash/pick')
const { fetchRelations } = require('../relations')

module.exports = function (data) {
  function where(tableName, whereCondition) {
    return data[tableName].filter(entity =>
      every(whereCondition, (value, key) => {
        if (isArray(value)) {
          return value.includes(entity[key])
        }
        return entity[key] === value
      })
    )
  }

  async function get(query) {
    let list = where(query.tableName, query.where)
    if (!query.returnArray) {
      if (!list.length) {
        throw new Error('No item found')
      }
      list = [list[0]]
    }
    if (!isEmpty(query.columns)) {
      list = list.map(i => pick(i, query.columns))
    } else {
      list = list.map(clone)
    }
    await fetchRelations(list, query)
    for (const converter of query.converter) {
      list = await converter(list)
    }

    return query.returnArray ? list : list[0]
  }

  function post(query) {
    const newEntries = isArray(query.data) ? query.data : [query.data]
    newEntries.map(entry => {
      query.where = {}
      query.pk.map(key => (query.where[key] = entry[key]))
      const item = where(query.tableName, query.where)[0]
      if (item) {
        throw Error(`Item with key ${query.data} already exists`)
      }
      data[query.tableName].push(entry)
    })
    return query.data
  }

  function put(query) {
    const item = where(query.tableName, query.where)[0]
    Object.assign(item, query.data)
    return item
  }

  function del(query) {
    const item = where(query.tableName, query.where)[0]
    if (!item) {
      throw Error(`Item with key ${query.where} does not exist`)
    }
    remove(data[query.tableName], item)
  }

  return {
    get,
    put,
    post,
    del,
  }
}
