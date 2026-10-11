async function listUsers(database) {
  return database.query('select * from users');
}

module.exports = { listUsers };
