import MaterialIcons from '@react-native-vector-icons/material-icons/static'
import { Dimensions, Text, View } from 'react-native'

import ScaledImage from '@components/views/ScaledImage'
import { Chats } from '@lib/state/Chat'
import { Theme } from '@lib/theme/ThemeManager'

type ChatAttachmentsProps = {
    entry: Chats.db.live.LiveEntry
}

const ChatAttachments: React.FC<ChatAttachmentsProps> = ({ entry }) => {
    const { color, spacing, borderRadius } = Theme.useTheme()
    if (entry.attachments.length < 1) return
    const images = entry.attachments.filter((item) => item.type === 'image')
    const documents = entry.attachments.filter((item) => item.type === 'document')
    return (
        <View style={{ rowGap: 8 }}>
            {documents.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s }}>
                    {documents.map((item) => (
                        <View
                            key={item.uri}
                            style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                columnGap: spacing.s,
                                paddingVertical: spacing.s,
                                paddingHorizontal: spacing.m,
                                borderRadius: borderRadius.m,
                                backgroundColor: color.neutral._300,
                                maxWidth: '100%',
                            }}>
                            <MaterialIcons name="description" size={18} color={color.text._300} />
                            <Text numberOfLines={1} style={{ color: color.text._300, flexShrink: 1 }}>
                                {item.name}
                            </Text>
                        </View>
                    ))}
                </View>
            )}
            {images.length > 0 && (
                <View
                    style={{
                        paddingVertical: 4,
                        rowGap: 8,
                        columnGap: 8,
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                    }}>
                    {images.map((item) => (
                        <ScaledImage
                            cachePolicy="none"
                            key={item.uri}
                            uri={item.uri}
                            style={{ height: Dimensions.get('window').height / 8, borderRadius: 8 }}
                        />
                    ))}
                </View>
            )}
        </View>
    )
}

export default ChatAttachments
