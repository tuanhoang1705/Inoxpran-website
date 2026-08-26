'use strict'

const escapeRegex = (value = '') =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const foldVietnameseText = (value) =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, (character) => (character === 'đ' ? 'd' : 'D'))
        .toLowerCase()
        .trim()

const buildProductSearchTokens = (value) => {
    const normalized = String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
    if (!normalized) return []

    const rawTokens = normalized
        .toLocaleLowerCase('vi')
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
    const tokens = []
    const seen = new Set()
    rawTokens.forEach((raw) => {
        const folded = foldVietnameseText(raw)
        if (folded.length < 2 || seen.has(folded)) return
        seen.add(folded)
        tokens.push({ raw, folded })
    })
    return tokens
}

const buildStrictProductSearchFilter = ({
    baseFilter = {},
    searchTerm
} = {}) => {
    const tokens = buildProductSearchTokens(searchTerm)
    if (!tokens.length) return { ...baseFilter }

    const tokenClauses = tokens.map(({ raw, folded }) => ({
        $or: [
            { product_name: { $regex: escapeRegex(raw), $options: 'i' } },
            {
                product_name_normalized: {
                    $regex: escapeRegex(raw),
                    $options: 'i'
                }
            },
            { product_slug: { $regex: escapeRegex(folded), $options: 'i' } }
        ]
    }))

    return {
        ...baseFilter,
        $and: [
            ...(Array.isArray(baseFilter.$and) ? baseFilter.$and : []),
            ...tokenClauses
        ]
    }
}

module.exports = {
    buildProductSearchTokens,
    buildStrictProductSearchFilter,
    foldVietnameseText
}
