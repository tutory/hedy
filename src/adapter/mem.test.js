'use strict'

const expect = require('expect.js')
const hedy = require('..')
const memAdapter = require('./mem')

describe('mem-adapter', function () {
  let commentQuery, data, friendQuery, store, userQuery

  beforeEach(function () {
    data = {
      user: [
        { id: 1, name: 'heiner', age: 20 },
        { id: 2, name: 'klaus', age: 27 },
        { id: 3, name: 'manfred', age: 27 },
      ],
      friend: [
        { user1Id: 1, user2Id: 2 },
        { user1Id: 2, user2Id: 3 },
      ],
      comment: [
        { id: 1, userId: 2, text: 'gorgeous' },
        { id: 2, userId: 3, text: 'nice' },
        { id: 4, userId: 1, text: 'splended' },
        { id: 5, userId: 2, text: 'awesome' },
      ],
    }
    store = hedy(memAdapter(data))
    commentQuery = store('comment')
    userQuery = store('user').hasMany(commentQuery)
    friendQuery = store('friend').pk(['user1Id', 'user2Id'])
  })

  describe('get', function () {
    it('should allow to fetch all', async function () {
      const users = await userQuery.load()
      expect(users).to.eql(data.user)
    })

    it('should allow to filter one', async function () {
      const users = await userQuery.where({ name: 'heiner' }).load()
      expect(users).to.eql([data.user[0]])
    })

    it('should be able to reuse query (immutability)', async function () {
      const allQuery = userQuery
      const heinerQuery = userQuery.where({ name: 'heiner' })
      const agedHeinerQuery = heinerQuery.where({ age: 100 })

      const agedHeinerUsers = await agedHeinerQuery.load()
      expect(agedHeinerUsers).to.have.length(0)

      const allUsers = await allQuery.load()
      expect(allUsers).to.eql(data.user)

      const heinerUsers = await heinerQuery.load()
      expect(heinerUsers[0]).to.eql(data.user[0])
    })

    it('should allow to filter many (WHERE IN)', async function () {
      const users = await userQuery.where({ name: ['klaus', 'heiner'] }).load()
      expect(users).to.eql([data.user[0], data.user[1]])
    })

    it('should run methods on result', async function () {
      const users = await userQuery.filter(user => user.id > 1).load()
      expect(users).to.eql([data.user[1], data.user[2]])
    })

    it('should allow to fetch relations', async function () {
      const users = await userQuery.with('comments').load()
      expect(users[0].comments[0].text).to.be('splended')
    })

    it('should fetch one by id', async function () {
      const user = await userQuery.get(3)
      expect(user).to.eql(data.user[2])
    })

    it('should fetch one by combined id', async function () {
      const friendship = await friendQuery.get([2, 3])
      expect(friendship).to.eql(data.friend[1])
    })

    it('should only select certain columns', async function () {
      const user = await userQuery.columns(['name']).get(3)
      expect(user).to.eql({ name: data.user[2].name })
    })
  })

  describe('first', function () {
    it('should fetch first matching', async function () {
      const user = await userQuery
        .hasMany(commentQuery)
        .with('comments')
        .first({ age: 27 })
      expect(user.id).to.eql(data.user[1].id)
      expect(user.comments).to.have.length(2)
    })
  })

  describe('create', function () {
    it('should create item with data from query', async function () {
      const savedFrieda = await userQuery.post({
        id: 4,
        name: 'frieda',
      })
      expect(savedFrieda.name).to.be('frieda')
      const friedaFromDb = await userQuery.get(4)
      expect(friedaFromDb.name).to.be('frieda')
      expect(friedaFromDb.age).to.be(undefined)
    })
  })

  describe('delete', () => {
    it('should delete item by id', async function () {
      let exeptionThrown = false
      await userQuery.del(3)
      try {
        await userQuery.get(3)
        throw new Error('should not happen')
      } catch (err) {
        exeptionThrown = true
      }
      expect(exeptionThrown).to.be(true)
    })
  })

  describe('update', () => {
    it('should replace data from query', async function () {
      const updatedFrieda = await userQuery.put(2, { name: 'frieda' })
      expect(updatedFrieda.name).to.be('frieda')
      const friedaFromDb = await userQuery.get(2)
      expect(friedaFromDb.name).to.be('frieda')
      expect(friedaFromDb.age).to.be(27)
    })
  })
})
